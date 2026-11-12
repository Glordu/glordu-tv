// The page stack and remote keys: moving between pages, the Back sequence,
// the idle return to the first page, and typing in text fields.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp } from './helpers/app.mjs';

const MINUTE = 60 * 1000;

// Three fake pages that log what the stack does to them. `resets` lets a
// page claim Back once (like Weather returning to today).
function app(options) {
  const win = loadApp(['js/core.js', 'js/perf.js', 'platform/browser.js'], { GTV: {} }, { fakeTimers: true });
  const GTV = win.GTV;
  const log = [];
  const exits = [];
  const state = { resets: 0, handlesLeft: false };
  ['first', 'second', 'third'].forEach((id) => {
    GTV.register({
      id: id,
      mount: () => ({
        onShow: () => log.push('show ' + id),
        onHide: () => log.push('hide ' + id),
        onKey: (key) => {
          log.push(id + ' key ' + key);
          return key === 'LEFT' && state.handlesLeft;
        },
        onBack: () => {
          if (id === 'second' && state.resets > 0) {
            state.resets--;
            return true;
          }
          return false;
        },
      }),
    });
  });
  GTV.config = Object.assign({ pages: ['first', 'second', 'third'] }, options && options.config);
  GTV.data = {};
  GTV.platform = Object.assign({}, GTV.platforms.browser, { exit: () => exits.push(Date.now()) });
  GTV.start(win.document.createElement('div'), 'first');
  log.length = 0;
  const current = () => {
    const shows = log.filter((l) => l.startsWith('show ') || l.startsWith('hide '));
    const last = shows.filter((l) => l.startsWith('show ')).pop();
    return last ? last.slice(5) : 'first';
  };
  return { win, GTV, log, exits, state, current };
}

test('down and up move between pages, hiding one and showing the other', () => {
  const { win, log, current } = app();
  win.press('ArrowDown');
  assert.deepEqual(log.slice(-2), ['hide first', 'show second']);
  win.press('ArrowDown');
  assert.equal(current(), 'third');
  win.press('ArrowUp');
  assert.equal(current(), 'second');
});

test('past the first or last page the stack bounces instead of moving', () => {
  const { win, log } = app();
  win.press('ArrowUp');
  assert.ok(!log.some((l) => l.startsWith('show') || l.startsWith('hide')), 'no page change above the first');
  win.press('ArrowDown');
  win.press('ArrowDown');
  log.length = 0;
  win.press('ArrowDown');
  assert.ok(!log.some((l) => l.startsWith('show') || l.startsWith('hide')), 'no page change below the last');
});

test('a page gets the keys first; unhandled up/down move the stack', () => {
  const { win, log, state, current } = app();
  state.handlesLeft = true;
  win.press('ArrowLeft');
  assert.deepEqual(log, ['first key LEFT']);
  win.press('ArrowDown');
  assert.ok(log.includes('first key DOWN'));
  assert.equal(current(), 'second');
});

test('Back lets the page reset first, then returns to the first page', () => {
  const { win, state, current } = app();
  win.press('ArrowDown');
  state.resets = 1;
  win.press('Escape');
  assert.equal(current(), 'second', 'the page reset itself');
  win.press('Escape');
  assert.equal(current(), 'first');
});

test('on the first page, Back twice within 2 seconds exits', () => {
  const { win, exits } = app();
  win.press('Escape');
  assert.equal(exits.length, 0);
  assert.equal(win.document.getElementById('toast').textContent, 'Press Back again to exit');
  win.press('Escape');
  assert.equal(exits.length, 1);
});

test('a second Back after the 2 seconds only shows the prompt again', () => {
  const { win, exits } = app();
  const realNow = win.Date.now;
  win.press('Escape');
  win.Date.now = () => realNow() + 2500;
  try {
    win.press('Escape');
  } finally {
    win.Date.now = realNow;
  }
  assert.equal(exits.length, 0);
});

test('any other key in between cancels a pending exit', () => {
  const { win, exits } = app();
  win.press('Escape');
  win.press('ArrowLeft');
  win.press('Escape');
  assert.equal(exits.length, 0);
});

test('after 5 idle minutes on another page, the stack returns to the first', () => {
  const { win, current } = app();
  win.press('ArrowDown');
  win.tick(4 * MINUTE);
  assert.equal(current(), 'second');
  win.press('ArrowLeft'); // a key press restarts the wait
  win.tick(4 * MINUTE);
  assert.equal(current(), 'second');
  win.tick(1.1 * MINUTE);
  assert.equal(current(), 'first');
});

test('the idle wait follows config.idleReturnMinutes', () => {
  const { win, current } = app({ config: { idleReturnMinutes: 1 } });
  win.press('ArrowDown');
  win.tick(1.1 * MINUTE);
  assert.equal(current(), 'first');
});

test('while typing in a text field, letters, Backspace and arrows stay in the field', () => {
  const { win, log } = app();
  const input = { tagName: 'INPUT' };
  assert.equal(win.press('i', input), false, 'letters reach the field');
  assert.equal(win.press('Backspace', input), false, 'Backspace deletes in the field');
  assert.equal(win.press('ArrowLeft', input), false, 'the caret moves');
  assert.ok(!log.some((l) => l.includes('INFO') || l.includes('LEFT')), 'no remote shortcut fired');
  assert.equal(win.press('ArrowDown', input), true, 'down still leaves the field');
});

test('the Yellow key shows and hides the performance readout', () => {
  const { win } = app();
  const readout = () => win.storage.get('gtv:perf');
  win.press('y');
  assert.equal(readout(), '1');
  win.press('y');
  assert.equal(readout(), '0');
});
