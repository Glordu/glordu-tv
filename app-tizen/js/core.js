// App shell: module registry, screen navigation and remote-key dispatch.
//
// A module is registered with GTV.register({ id, title, description, inHome,
// mount(el, ctx) }). mount() fills `el` and returns an object with optional
// onKey(key) -> handled? and unmount(). Keys are platform-neutral names
// (LEFT, ENTER, BACK, PLAY_PAUSE, ...) produced by the platform adapter.
//
// Written for the TV's older Chromium: no optional chaining, no ?? operator.
(function () {
  'use strict';

  const GTV = window.GTV;
  GTV.VERSION = '0.1.0';
  GTV.platforms = GTV.platforms || {};

  const registry = {};
  const order = [];
  let stack = []; // module ids, bottom to top
  let active = null; // { id, el, instance }
  let root = null;
  let toastTimer = null;

  GTV.register = function (def) {
    if (!registry[def.id]) order.push(def.id);
    registry[def.id] = def;
  };

  GTV.modules = function () {
    return order.map((id) => registry[id]);
  };

  function moduleConfig(id) {
    const modules = (GTV.config && GTV.config.modules) || {};
    return modules[id] || {};
  }

  function mount(id) {
    if (active) {
      try {
        if (active.instance.unmount) active.instance.unmount();
      } catch (err) {
        console.error(err);
      }
      root.removeChild(active.el);
      active = null;
    }
    const el = document.createElement('div');
    el.className = 'screen screen-' + id;
    root.appendChild(el);
    const ctx = {
      id: id,
      config: moduleConfig(id),
      data: GTV.data,
      platform: GTV.platform,
      open: GTV.open,
      back: GTV.back,
      toast: GTV.toast,
    };
    active = { id: id, el: el, instance: registry[id].mount(el, ctx) || {} };
  }

  GTV.open = function (id) {
    if (!registry[id]) {
      GTV.toast('Unknown module: ' + id);
      return;
    }
    stack.push(id);
    mount(id);
  };

  // Back pops a screen; from the start screen it goes home; from home it exits.
  GTV.back = function () {
    if (stack.length > 1) {
      stack.pop();
      mount(stack[stack.length - 1]);
    } else if (stack[0] !== 'home') {
      stack = ['home'];
      mount('home');
    } else {
      GTV.platform.exit();
    }
  };

  GTV.toast = function (message) {
    const el = document.getElementById('toast');
    el.textContent = message;
    el.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('is-visible'), 3000);
  };

  function onKeyDown(event) {
    const key = GTV.platform.keyName(event);
    if (!key) return;
    event.preventDefault();
    const instance = active && active.instance;
    if (instance && instance.onKey && instance.onKey(key)) return;
    if (key === 'BACK') GTV.back();
  }

  GTV.start = function (rootEl, startId) {
    root = rootEl;
    root.innerHTML = '';
    document.addEventListener('keydown', onKeyDown);
    GTV.open(registry[startId] ? startId : 'home');
  };
})();
