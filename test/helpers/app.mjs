// Loads app files (classic browser scripts) into a sandbox with just enough
// of a browser faked to run their logic: a minimal DOM, localStorage,
// timers. Tests then drive the code through window.GTV.
//
//   const win = loadApp(['js/prefs.js', 'js/location.js'], { GTV: { ... } });
//   win.GTV.location.get()
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
    focus() {},
    blur() {},
    scrollIntoView() {},
    getBoundingClientRect: () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }),
  };
  return el;
}

export function loadApp(files, globals) {
  const storage = new Map();
  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    // Recurring timers never fire in tests; they'd keep Node running.
    setInterval: () => 0,
    clearInterval: () => {},
    requestAnimationFrame: (fn) => setTimeout(() => fn(Date.now()), 0),
    performance,
    URL,
    fetch: () => Promise.reject(new Error('No network in tests')),
    localStorage: {
      getItem: (k) => (storage.has(k) ? storage.get(k) : null),
      setItem: (k, v) => storage.set(k, String(v)),
      removeItem: (k) => storage.delete(k),
    },
    document: {
      createElement: fakeElement,
      getElementById: () => fakeElement('div'),
      addEventListener() {},
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
  return sandbox;
}

// Copies a value out of the sandbox as plain test-realm data.
export const plain = (value) => JSON.parse(JSON.stringify(value));

// Lets pending promise callbacks run.
export const settle = () => new Promise((r) => setTimeout(r, 0));
