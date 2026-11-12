// Reading the log from the TV (scripts/tv-log.mjs): finding the debug port
// and printing what was stored.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { debugPort, formatLog, describeStart } from '../scripts/tv-log.mjs';

test('the debug port is read from the launch output', () => {
  assert.equal(debugPort('... successfully launched pid = 2094 with debug 1 port: 41320\r\n'), 41320);
  assert.throws(() => debugPort('error: app not installed'), /No debug port/);
});

test('the log prints one line per entry, oldest first, with repeat counts', () => {
  const at = new Date(2026, 10, 12, 22, 40, 5).getTime();
  assert.equal(
    formatLog([
      { at: at, level: 'info', msg: 'Started 0.2.0 (tizen)' },
      { at: at + 1000, level: 'error', msg: 'Uncaught TypeError: boom', n: 3 },
    ]),
    '2026-11-12 22:40:05  info   Started 0.2.0 (tizen)\n2026-11-12 22:40:06  ERROR  Uncaught TypeError: boom  (x3)'
  );
  assert.equal(formatLog([]), 'The log is empty.');
});

test('it says whether the app started, or what is on screen instead', () => {
  assert.equal(describeStart({ started: true, boot: null }), 'The app is running.');
  assert.equal(describeStart({ started: false, boot: "Couldn't start: boom" }), "The app has not started. On screen: Couldn't start: boom");
  assert.equal(describeStart({ started: false, boot: null }), 'The app has not started. On screen: (nothing)');
});
