// The problem log: what it records, how it keeps its size, and showing a
// failed start on screen instead of "Loading…".

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp, plain } from './helpers/app.mjs';

const MINUTE = 60 * 1000;

// The log on its own, with a console that remembers what reached it.
function logApp(options) {
  const reached = [];
  const quiet = (level) => (...args) => reached.push(level + ': ' + args.join(' '));
  const win = loadApp(['js/log.js'], { console: { warn: quiet('warn'), error: quiet('error'), log() {} } }, Object.assign({ fakeTimers: true }, options));
  win.reached = reached;
  return win;
}

const entries = (win) => plain(win.GTV.log.entries());
const onScreen = (win) => {
  const app = win.document.getElementById('app');
  const last = app.children[app.children.length - 1];
  return last ? last.textContent : null;
};

test('warnings and errors are kept in order, and still reach the console', () => {
  const win = logApp();
  win.console.warn('Weather unavailable', 'HTTP 503');
  win.console.error('Something broke');
  assert.deepEqual(
    entries(win).map((e) => [e.level, e.msg]),
    [
      ['warn', 'Weather unavailable HTTP 503'],
      ['error', 'Something broke'],
    ]
  );
  assert.deepEqual(win.reached, ['warn: Weather unavailable HTTP 503', 'error: Something broke']);
  assert.equal(typeof entries(win)[0].at, 'number');
});

test('an error is kept as its message and the file and line it came from', () => {
  const win = logApp();
  const err = { name: 'TypeError', message: 'x is not a function', stack: 'TypeError: x is not a function\n    at Ambient.next (file:///modules/ambient.js:301:12)\n    at core.js:5:1' };
  win.console.error(err);
  assert.equal(entries(win)[0].msg, 'TypeError: x is not a function (modules/ambient.js:301)');
});

test('the same message again is counted, not stored twice', () => {
  const win = logApp();
  win.console.warn('offline');
  win.console.warn('offline');
  win.console.warn('offline');
  win.console.warn('back');
  win.console.warn('offline');
  assert.deepEqual(
    entries(win).map((e) => [e.msg, e.n || 1]),
    [
      ['offline', 3],
      ['back', 1],
      ['offline', 1],
    ]
  );
});

test('only the last 100 entries are kept, and long messages are cut short', () => {
  const win = logApp();
  for (let i = 0; i < 130; i++) win.console.warn('problem ' + i);
  const list = entries(win);
  assert.equal(list.length, 100);
  assert.equal(list[0].msg, 'problem 30');
  assert.equal(list[99].msg, 'problem 129');
  win.console.warn('x'.repeat(2000));
  assert.equal(entries(win)[99].msg.length, 500);
});

test('the log outlives a restart, and an unreadable one starts over', () => {
  const win = logApp();
  win.console.warn('before the restart');
  const again = logApp();
  again.storage.set('gtv:log', win.storage.get('gtv:log'));
  again.console.warn('after');
  assert.deepEqual(
    entries(again).map((e) => e.msg),
    ['before the restart', 'after']
  );
  again.storage.set('gtv:log', '{not json');
  again.console.warn('fresh');
  assert.deepEqual(
    entries(again).map((e) => e.msg),
    ['fresh']
  );
});

test('uncaught errors and unhandled promise failures are recorded', () => {
  const win = logApp();
  win.fire('error', { target: win, message: 'Uncaught TypeError: boom', filename: 'file:///js/core.js', lineno: 12 });
  win.fire('unhandledrejection', { reason: { name: 'Error', message: 'HTTP 500', stack: '' } });
  assert.deepEqual(
    entries(win).map((e) => e.msg),
    ['Uncaught TypeError: boom (js/core.js:12)', 'Uncaught (in promise) Error: HTTP 500']
  );
});

test('a script that fails to load is recorded; the TV-only API script is ignored in a browser', () => {
  const win = logApp();
  win.fire('error', { target: { tagName: 'SCRIPT', src: 'http://localhost:8080/app-tizen/$WEBAPIS/webapis/webapis.js' } });
  win.fire('error', { target: { tagName: 'IMG', src: 'https://example.test/photo.jpg' } });
  assert.deepEqual(entries(win), []);
  win.fire('error', { target: { tagName: 'SCRIPT', src: 'file:///js/weather.js' } });
  assert.deepEqual(
    entries(win).map((e) => e.msg),
    ["Couldn't load js/weather.js"]
  );
  win.location.protocol = 'file:'; // on the TV, it matters
  win.fire('error', { target: { tagName: 'SCRIPT', src: 'file:///$WEBAPIS/webapis/webapis.js' } });
  assert.equal(entries(win)[1].msg, "Couldn't load webapis/webapis.js");
});

test('an error before the app has started replaces "Loading…"; a warning does not', () => {
  const win = logApp();
  win.console.warn("Couldn't fetch config.json: offline, using the saved copy");
  assert.equal(onScreen(win), null);
  win.fire('unhandledrejection', { reason: { name: 'TypeError', message: 'GTV.start is not a function', stack: '' } });
  assert.equal(onScreen(win), "Couldn't start: Uncaught (in promise) TypeError: GTV.start is not a function");
});

test('once started, errors are only logged', () => {
  const win = logApp();
  win.GTV.log.started('Started 0.2.0 (tizen)');
  win.console.error('later problem');
  assert.equal(onScreen(win), null);
  assert.deepEqual(
    entries(win).map((e) => [e.level, e.msg]),
    [
      ['info', 'Started 0.2.0 (tizen)'],
      ['error', 'later problem'],
    ]
  );
});

test('an app that has not started after a minute says so on screen and in the log', () => {
  const win = logApp();
  win.tick(MINUTE - 1);
  assert.equal(onScreen(win), null);
  win.tick(1);
  assert.equal(onScreen(win), "Couldn't start: Still not started after a minute");
  assert.equal(entries(win)[0].level, 'error');

  const fine = logApp();
  fine.GTV.log.started('Started');
  fine.tick(2 * MINUTE);
  assert.deepEqual(
    entries(fine).map((e) => e.msg),
    ['Started']
  );
});

test('clear empties the log', () => {
  const win = logApp();
  win.console.warn('something');
  win.GTV.log.clear();
  assert.deepEqual(entries(win), []);
});
