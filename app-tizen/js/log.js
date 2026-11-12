// Problem log: the last 100 warnings, errors and app starts, kept in this
// TV's localStorage so they outlive a crash or restart. Read them in
// Settings → Log, or from the PC with scripts/tv-log.mjs, which works even
// when the app never gets as far as showing Settings.
//
// Loaded before every other script, so it also catches what goes wrong while
// they load. It records console.warn and console.error, uncaught errors,
// promises that fail with nothing handling them, and scripts or stylesheets
// that fail to load. The same message twice in a row is counted, not stored
// again. Until the app has started, an error also replaces "Loading…" on
// screen, and so does a start that still hasn't happened after a minute.
//
// Written for the TV's older Chromium: no optional chaining, no ?? operator.
(function () {
  'use strict';

  const GTV = (window.GTV = window.GTV || {});
  const KEY = 'gtv:log';
  const MAX_ENTRIES = 100;
  const MAX_TEXT = 500;
  const START_WAIT_MS = 60 * 1000;

  let started = false;
  let failure = null; // shown instead of "Loading…" if starting fails

  function read() {
    try {
      const list = JSON.parse(localStorage.getItem(KEY) || '[]');
      return Array.isArray(list) ? list : [];
    } catch (err) {
      return [];
    }
  }

  function write(list) {
    try {
      localStorage.setItem(KEY, JSON.stringify(list));
    } catch (err) {
      // Storage full or unavailable: nowhere to keep it.
    }
  }

  // "js/core.js" from "file:///js/core.js" or "http://localhost:8080/app-tizen/js/core.js".
  function shortFile(url) {
    const match = /([^/]+\/[^/]+)$/.exec(String(url || '').split('?')[0]);
    return match ? match[1] : String(url || '');
  }

  // An error's message plus where it happened (the first line of its stack
  // that names a file); anything else as text.
  function describe(value) {
    if (value && typeof value === 'object' && 'message' in value) {
      const lines = String(value.stack || '').split('\n');
      let where = '';
      for (let i = 1; i < lines.length && !where; i++) {
        const match = /([^\s()/]+\/[^\s()/]+):(\d+):\d+\)?\s*$/.exec(lines[i]);
        if (match) where = ' (' + match[1] + ':' + match[2] + ')';
      }
      return (value.name ? value.name + ': ' : '') + value.message + where;
    }
    if (typeof value === 'string') return value;
    try {
      return JSON.stringify(value);
    } catch (err) {
      return String(value);
    }
  }

  function showFailure() {
    if (started || !failure) return;
    const app = document.getElementById('app');
    if (!app) return; // the page isn't parsed yet; shown once it is
    app.innerHTML = '';
    const el = document.createElement('div');
    el.className = 'boot';
    el.textContent = "Couldn't start: " + failure;
    app.appendChild(el);
  }

  function add(level, message) {
    let text = String(message);
    if (text.length > MAX_TEXT) text = text.slice(0, MAX_TEXT - 1) + '…';
    const list = read();
    const last = list[list.length - 1];
    if (last && last.level === level && last.msg === text) {
      last.n = (last.n || 1) + 1;
      last.at = Date.now();
    } else {
      list.push({ at: Date.now(), level: level, msg: text });
    }
    if (list.length > MAX_ENTRIES) list.splice(0, list.length - MAX_ENTRIES);
    write(list);
    if (level === 'error' && !started) {
      failure = text;
      showFailure();
    }
  }

  ['warn', 'error'].forEach((level) => {
    const original = console[level];
    console[level] = function () {
      original.apply(console, arguments);
      add(level, Array.prototype.map.call(arguments, describe).join(' '));
    };
  });

  if (window.addEventListener) {
    // Capturing, so it also hears about <script> and <link> that fail to load.
    window.addEventListener(
      'error',
      (event) => {
        const el = event.target;
        if (el && el !== window && el.tagName) {
          const url = el.src || el.href || '';
          // Samsung's TV API script only exists on the TV.
          if (/webapis/.test(url) && window.location.protocol !== 'file:') return;
          if (el.tagName === 'SCRIPT' || el.tagName === 'LINK') add('error', "Couldn't load " + shortFile(url));
          return;
        }
        const where = event.filename ? ' (' + shortFile(event.filename) + ':' + event.lineno + ')' : '';
        add('error', (event.message || describe(event.error)) + where);
      },
      true
    );
    window.addEventListener('unhandledrejection', (event) => {
      add('error', 'Uncaught (in promise) ' + describe(event.reason));
    });
  }
  if (document.addEventListener) document.addEventListener('DOMContentLoaded', showFailure);

  setTimeout(() => {
    if (!started) add('error', "Still not started after a minute");
  }, START_WAIT_MS);

  GTV.log = {
    // Oldest first: [{ at, level: 'error' | 'warn' | 'info', msg, n? }]
    entries: read,

    info: function (message) {
      add('info', message);
    },

    // The app is up: errors from now on are only logged, not put on screen.
    started: function (message) {
      started = true;
      add('info', message);
    },

    clear: function () {
      write([]);
    },
  };
})();
