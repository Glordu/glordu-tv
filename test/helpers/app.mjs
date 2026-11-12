// Loads app files (classic browser scripts) into a sandbox with just enough
// of a browser faked to run their logic: a minimal DOM, localStorage,
// timers, key events and images. Tests then drive the code through
// window.GTV.
//
//   const win = loadApp(['js/prefs.js', 'js/location.js'], { GTV: { ... } });
//   win.GTV.location.get()
//
// Options (third argument):
//   fakeTimers  setTimeout/requestAnimationFrame only run when the test calls
//               win.tick(ms), so minutes-long timers can be tested instantly
//   images      function(url) -> { width } for a photo that loads, or null for
//               one that fails; used by `new Image()` in the app
//
// Helpers on the returned window:
//   win.press(key, target)  dispatches a keydown, e.g. 'ArrowDown', 'Escape';
//                           pass { keyCode } as `key` for the TV's key codes
//   win.dispatch(type)      fires another document event, e.g. 'visibilitychange'
//   win.tick(ms)            advances fake timers
//   win.storage             the localStorage contents (a Map)
//
// Values from the sandbox come from another JavaScript realm; compare them
// with plain() (a JSON round trip) rather than deepStrictEqual directly.

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'app-tizen');

function fakeElement(tag) {
  const classes = new Set();
  const el = {
    tagName: String(tag).toUpperCase(),
    style: {},
    children: [],
    textContent: '',
    innerHTML: '',
    title: '',
    value: '',
    offsetWidth: 0,
    classList: {
      add: (...names) => names.forEach((n) => classes.add(n)),
      remove: (...names) => names.forEach((n) => classes.delete(n)),
      contains: (n) => classes.has(n),
      toggle: (n, force) => {
        const on = force === undefined ? !classes.has(n) : !!force;
        if (on) classes.add(n);
        else classes.delete(n);
        return on;
      },
    },
    get className() {
      return Array.from(classes).join(' ');
    },
    set className(value) {
      classes.clear();
      String(value).split(/\s+/).filter(Boolean).forEach((n) => classes.add(n));
    },
    appendChild(child) {
      el.children.push(child);
      return child;
    },
    removeChild(child) {
      el.children = el.children.filter((c) => c !== child);
      return child;
    },
    querySelector: () => null,
    querySelectorAll: () => [],
    setAttribute() {},
    focus() {
      fakeElement.active = el;
    },
    blur() {
      if (fakeElement.active === el) fakeElement.active = null;
    },
    scrollIntoView() {},
    getBoundingClientRect: () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }),
  };
  return el;
}

// A timer queue that only runs when told to.
function fakeTimerQueue() {
  let now = 0;
  let nextId = 1;
  const tasks = [];
  const set = (fn, ms) => {
    const id = nextId++;
    tasks.push({ id, at: now + (ms || 0), fn });
    return id;
  };
  const clear = (id) => {
    const i = tasks.findIndex((t) => t.id === id);
    if (i > -1) tasks.splice(i, 1);
  };
  const tick = (ms) => {
    const end = now + ms;
    for (;;) {
      tasks.sort((a, b) => a.at - b.at || a.id - b.id);
      const task = tasks[0];
      if (!task || task.at > end) break;
      tasks.shift();
      now = task.at;
      task.fn(now);
    }
    now = end;
  };
  return { set, clear, tick };
}

export function loadApp(files, globals, options) {
  options = options || {};
  const storage = new Map();
  const listeners = {};
  const byId = {};
  const timers = options.fakeTimers ? fakeTimerQueue() : null;
  const setT = timers ? timers.set : setTimeout;
  const clearT = timers ? timers.clear : clearTimeout;

  class FakeImage {
    constructor() {
      this.naturalWidth = 0;
      this.onload = null;
      this.onerror = null;
    }
    set src(url) {
      this._src = url;
      const result = options.images ? options.images(url) : { width: 1920 };
      setT(() => {
        if (result) {
          this.naturalWidth = result.width;
          if (this.onload) this.onload();
        } else if (this.onerror) this.onerror();
      }, 0);
    }
    get src() {
      return this._src;
    }
  }

  const sandbox = {
    console,
    setTimeout: setT,
    clearTimeout: clearT,
    // Recurring timers never fire in tests; they'd keep Node running.
    setInterval: () => 0,
    clearInterval: () => {},
    requestAnimationFrame: (fn) => setT(() => fn(Date.now()), 16),
    performance,
    URL,
    AbortController,
    Image: FakeImage,
    fetch: () => Promise.reject(new Error('No network in tests')),
    localStorage: {
      getItem: (k) => (storage.has(k) ? storage.get(k) : null),
      setItem: (k, v) => storage.set(k, String(v)),
      removeItem: (k) => storage.delete(k),
    },
    document: {
      createElement: fakeElement,
      getElementById: (id) => (byId[id] = byId[id] || fakeElement('div')),
      addEventListener: (type, fn) => (listeners[type] = listeners[type] || []).push(fn),
      get activeElement() {
        return fakeElement.active || null;
      },
      hidden: false,
    },
    location: { search: '', href: 'http://localhost/' },
  };
  sandbox.window = sandbox;
  Object.assign(sandbox, globals || {});
  vm.createContext(sandbox);
  // The sandbox's own Date, reachable from tests so they can move the clock
  // (win.Date.now = ...); built-ins aren't visible from outside otherwise.
  sandbox.Date = vm.runInContext('Date', sandbox);
  for (const file of files) {
    vm.runInContext(fs.readFileSync(path.join(APP, file), 'utf8'), sandbox, { filename: file });
  }

  sandbox.storage = storage;
  sandbox.tick = (ms) => {
    if (!timers) throw new Error('loadApp(..., { fakeTimers: true }) to use tick()');
    timers.tick(ms);
  };
  // Fires a document event the app listens for, e.g. 'visibilitychange'.
  sandbox.dispatch = (type, event) => (listeners[type] || []).forEach((fn) => fn(event || {}));
  sandbox.press = (key, target) => {
    let prevented = false;
    const event = {
      key: typeof key === 'string' ? key : '',
      keyCode: typeof key === 'object' ? key.keyCode : 0,
      target: target || { tagName: 'BODY' },
      ctrlKey: false,
      altKey: false,
      metaKey: false,
      preventDefault: () => (prevented = true),
    };
    (listeners.keydown || []).forEach((fn) => fn(event));
    return prevented;
  };
  return sandbox;
}

// Copies a value out of the sandbox as plain test-realm data.
export const plain = (value) => JSON.parse(JSON.stringify(value));

// Lets pending promise callbacks run.
export const settle = () => new Promise((r) => setTimeout(r, 0));
