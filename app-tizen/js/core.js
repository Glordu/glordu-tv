// App shell: modules shown as a vertical stack of pages, and remote-key
// dispatch.
//
//   ▲▼      previous / next page (a bounce at either end)
//   ◀▶ OK   handled by the page (photo, day, setting)
//   Back    the page resets itself first (e.g. back to today); then any page
//           returns to the first one; there, Back twice exits
//
// A module is registered with GTV.register({ id, title, mount(el, ctx) }).
// mount() fills `el` and returns an object with any of:
//   onKey(key) -> handled?   keys are platform-neutral names (LEFT, ENTER…);
//                            return false for UP/DOWN to let the stack move
//   onBack() -> handled?     return true if Back reset something on the page
//   onShow(), onHide()       the page became / stopped being the current one
//   unmount()
// Pages come from config.pages (default below); after config.idleReturnMinutes
// without a key press the stack returns to the first page.
//
// Written for the TV's older Chromium: no optional chaining, no ?? operator.
(function () {
  'use strict';

  const GTV = window.GTV;
  GTV.VERSION = '0.2.0';
  GTV.platforms = GTV.platforms || {};

  const DEFAULT_PAGES = ['ambient', 'weather', 'settings'];
  const EXIT_WINDOW_MS = 2000;
  const DOTS_MS = 1600;
  const DEFAULT_IDLE_MINUTES = 5;
  // While typing in a text field, only these reach the app; every other key
  // (letters, Backspace, ◀▶ to move the caret) belongs to the field.
  const EDITING_KEYS = ['ENTER', 'BACK', 'CANCEL', 'UP', 'DOWN'];

  const registry = {};
  let pages = []; // [{ id, instance }]
  let current = 0;
  let pagerEl = null;
  let stackEl = null;
  let dotsEl = null;
  let toastTimer = null;
  let dotsTimer = null;
  let idleTimer = null;
  let exitArmedUntil = 0;

  GTV.register = function (def) {
    registry[def.id] = def;
  };

  function moduleConfig(id) {
    const modules = (GTV.config && GTV.config.modules) || {};
    return modules[id] || {};
  }

  function call(page, method, arg) {
    const fn = page && page.instance[method];
    if (!fn) return undefined;
    try {
      return fn.call(page.instance, arg);
    } catch (err) {
      console.error(err);
      return undefined;
    }
  }

  function make(className, parent) {
    const el = document.createElement('div');
    el.className = className;
    parent.appendChild(el);
    return el;
  }

  function showDots() {
    Array.prototype.forEach.call(dotsEl.children, (dot, i) => dot.classList.toggle('is-current', i === current));
    dotsEl.classList.add('is-visible');
    clearTimeout(dotsTimer);
    dotsTimer = setTimeout(() => dotsEl.classList.remove('is-visible'), DOTS_MS);
  }

  function bounce(direction) {
    pagerEl.classList.remove('bounce-up', 'bounce-down');
    void pagerEl.offsetWidth; // restart the animation
    pagerEl.classList.add('bounce-' + direction);
    showDots();
  }

  function resetIdle() {
    clearTimeout(idleTimer);
    if (current === 0) return;
    const minutes = (GTV.config && GTV.config.idleReturnMinutes) || DEFAULT_IDLE_MINUTES;
    idleTimer = setTimeout(() => goTo(0), minutes * 60 * 1000);
  }

  function goTo(index) {
    if (index < 0 || index >= pages.length) {
      bounce(index < 0 ? 'up' : 'down');
      return;
    }
    if (index === current) return;
    call(pages[current], 'onHide');
    current = index;
    stackEl.style.transform = 'translateY(' + -100 * index + '%)';
    call(pages[current], 'onShow');
    showDots();
    resetIdle();
  }

  GTV.goTo = function (id) {
    for (let i = 0; i < pages.length; i++) if (pages[i].id === id) goTo(i);
  };

  GTV.toast = function (message, ms) {
    const el = document.getElementById('toast');
    el.textContent = message;
    el.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('is-visible'), ms || 3000);
  };

  function onBack() {
    if (call(pages[current], 'onBack')) return; // the page reset itself
    if (current !== 0) {
      goTo(0);
      return;
    }
    if (Date.now() < exitArmedUntil) {
      GTV.platform.exit();
      return;
    }
    exitArmedUntil = Date.now() + EXIT_WINDOW_MS;
    GTV.toast('Press Back again to exit', EXIT_WINDOW_MS);
  }

  function isTextField(el) {
    return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
  }

  function onKeyDown(event) {
    const editing = isTextField(event.target);
    if (editing && event.key === 'Backspace') return;
    const key = GTV.platform.keyName(event);
    if (!key) return;
    if (editing && EDITING_KEYS.indexOf(key) < 0) return;
    event.preventDefault();
    resetIdle();
    if (key === 'BACK') {
      onBack();
      return;
    }
    exitArmedUntil = 0;
    if (call(pages[current], 'onKey', key)) return;
    if (key === 'UP') goTo(current - 1);
    else if (key === 'DOWN') goTo(current + 1);
  }

  GTV.start = function (rootEl, startId) {
    rootEl.innerHTML = '';
    pagerEl = make('pager', rootEl);
    stackEl = make('pager-stack', pagerEl);
    dotsEl = make('pager-dots', rootEl);

    const ids = ((GTV.config && GTV.config.pages) || DEFAULT_PAGES).filter((id) => registry[id]);
    pages = ids.map((id, i) => {
      const el = make('page page-' + id, stackEl);
      el.style.top = 100 * i + '%';
      make('pager-dot', dotsEl);
      const ctx = {
        id: id,
        config: moduleConfig(id),
        data: GTV.data,
        platform: GTV.platform,
        toast: GTV.toast,
        goTo: GTV.goTo,
      };
      return { id: id, instance: registry[id].mount(el, ctx) || {} };
    });

    // Jump straight to the start page, without the slide.
    current = Math.max(0, ids.indexOf(startId));
    stackEl.style.transition = 'none';
    stackEl.style.transform = 'translateY(' + -100 * current + '%)';
    void stackEl.offsetWidth;
    stackEl.style.transition = '';
    pages.forEach((page, i) => call(page, i === current ? 'onShow' : 'onHide'));

    document.addEventListener('keydown', onKeyDown);
    resetIdle();
  };
})();
