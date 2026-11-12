// The Settings page: moving through its rows, leaving the page only past
// the first or last one, Back, choosing a city, and reading the log.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp } from './helpers/app.mjs';

const LISBON = { name: 'Lisbon', region: 'Lisbon District', country: 'Portugal', latitude: 38.72, longitude: -9.14, timezone: 'Europe/Lisbon' };

function settings(logEntries) {
  const toasts = [];
  const entries = logEntries || [];
  const win = loadApp(['js/prefs.js', 'modules/settings.js'], {
    GTV: {
      register(def) {
        this.defs = this.defs || {};
        this.defs[def.id] = def;
      },
      location: {
        current: () => null,
        get: () => Promise.resolve(null),
        onChange: () => () => {},
        describe: (loc) => (loc ? loc.name : ''),
        search: () => Promise.resolve([LISBON]),
      },
      clock: { tvZone: () => 'Europe/Madrid', format: () => '12:00', mode: () => '24h', zone: () => null },
      weather: { units: () => 'celsius' },
      log: { entries: () => entries },
      VERSION: 'test',
    },
  });
  const ctx = { toast: (m) => toasts.push(m), platform: { name: 'test' }, data: { configUrl: 'https://example.test/config.json', log: {} } };
  const page = win.GTV.defs.settings.mount(win.document.createElement('div'), ctx);
  return { win, page, toasts };
}

test('down and up move between settings rows', () => {
  const { page } = settings();
  assert.equal(page.focus, 0);
  assert.equal(page.onKey('DOWN'), true);
  assert.equal(page.focus, 1);
  assert.equal(page.onKey('UP'), true);
  assert.equal(page.focus, 0);
});

test('up from the first row and down from the last leave the page', () => {
  const { page } = settings();
  assert.equal(page.onKey('UP'), false, 'up from the first row');
  while (page.focus < page.rows.length - 1) page.onKey('DOWN');
  assert.equal(page.onKey('DOWN'), false, 'down from the last row');
});

test('Back returns to the first row, then lets the app handle it', () => {
  const { page } = settings();
  page.onKey('DOWN');
  page.onKey('DOWN');
  assert.equal(page.onBack(), true);
  assert.equal(page.focus, 0);
  assert.equal(page.onBack(), false);
});

test('left and right change a setting', () => {
  const { win, page } = settings();
  page.onKey('DOWN');
  page.onKey('DOWN'); // Temperature
  page.onKey('RIGHT');
  assert.equal(win.GTV.prefs.get('units'), 'fahrenheit');
});

test('OK on Location opens the city search; Back closes it', () => {
  const { page } = settings();
  page.onKey('ENTER');
  assert.equal(page.mode, 'search');
  assert.equal(page.onBack(), true);
  assert.equal(page.mode, 'list');
});

test('picking a search result saves it as the chosen city', async () => {
  const { win, page, toasts } = settings();
  page.onKey('ENTER');
  page.input.value = 'Lisbon';
  page.input.focus();
  page.onKey('ENTER'); // search
  await new Promise((r) => setTimeout(r, 0));
  page.onKey('ENTER'); // pick the first result
  assert.equal(win.GTV.prefs.get('locationMode'), 'manual');
  assert.equal(win.GTV.prefs.get('manualLocation').name, 'Lisbon');
  assert.equal(page.mode, 'list');
  assert.match(toasts.pop(), /Lisbon/);
});

test('leaving the page closes an open city search', () => {
  const { page } = settings();
  page.onKey('ENTER');
  page.onHide();
  assert.equal(page.mode, 'list');
});

// ---- Log --------------------------------------------------------------------

const at = (hh, mm) => new Date(2026, 10, 12, hh, mm, 0).getTime();
const logRow = (page) => page.rows.findIndex((row) => row.label === 'Log');
const shownLog = (page) => page.logEl.children.map((el) => el.children.map((c) => c.textContent).join(' | '));

function openLog(entries) {
  const s = settings(entries);
  while (s.page.focus < logRow(s.page)) s.page.onKey('DOWN');
  s.page.onKey('ENTER');
  return s;
}

test('the Log row counts errors and warnings, repeats included, and says when the latest was', () => {
  const { page } = settings([
    { at: at(9, 0), level: 'info', msg: 'Started 0.2.0 (tizen)' },
    { at: at(9, 5), level: 'warn', msg: 'Weather unavailable', n: 3 },
    { at: at(9, 7), level: 'error', msg: 'Uncaught TypeError: boom' },
    { at: at(9, 8), level: 'info', msg: 'Started 0.2.0 (tizen)' },
  ]);
  assert.equal(page.rows[logRow(page)].value(), '1 error, 3 warnings · latest 12 Nov 09:07:00');
});

test('with only app starts logged, the Log row says there are no problems', () => {
  const { page } = settings([{ at: at(9, 0), level: 'info', msg: 'Started 0.2.0 (tizen)' }]);
  assert.equal(page.rows[logRow(page)].value(), 'No problems');
});

test('OK on Log shows it newest first, with repeat counts', () => {
  const { page } = openLog([
    { at: at(9, 0), level: 'info', msg: 'Started' },
    { at: at(9, 5), level: 'warn', msg: 'Weather unavailable', n: 3 },
  ]);
  assert.equal(page.mode, 'log');
  assert.deepEqual(shownLog(page), ['12 Nov 09:05:00 | Weather unavailable | ×3', '12 Nov 09:00:00 | Started']);
  assert.equal(page.logEl.children[0].className, 'settings-log-entry is-warn');
});

test('a long log scrolls one entry at a time with ▲▼, within its ends, and keeps the page', () => {
  const entries = Array.from({ length: 20 }, (_, i) => ({ at: at(10, i), level: 'warn', msg: 'problem ' + i }));
  const { page } = openLog(entries);
  assert.equal(page.logEl.children.length, 12);
  assert.match(shownLog(page)[0], /problem 19$/);
  assert.equal(page.onKey('UP'), true, 'up at the top stays on the log');
  assert.match(shownLog(page)[0], /problem 19$/);
  for (let i = 0; i < 30; i++) assert.equal(page.onKey('DOWN'), true);
  assert.match(shownLog(page)[0], /problem 11$/, 'stops with the oldest at the bottom');
  assert.match(shownLog(page)[11], /problem 0$/);
  assert.match(page.logStatus.textContent, /9–20 of 20/);
  page.onKey('UP');
  assert.match(shownLog(page)[0], /problem 12$/, 'up goes back at once from the end');
});

test('Back, or leaving the page, closes the log', () => {
  const { page } = openLog([]);
  assert.match(page.logStatus.textContent, /Nothing logged yet/);
  assert.equal(page.onBack(), true);
  assert.equal(page.mode, 'list');
  assert.equal(page.focus, logRow(page), 'still on the Log row');
  page.onKey('ENTER');
  page.onHide();
  assert.equal(page.mode, 'list');
});

test('left and right on the Log row change nothing', () => {
  const { page } = settings([]);
  while (page.focus < logRow(page)) page.onKey('DOWN');
  assert.equal(page.onKey('LEFT'), true);
  assert.equal(page.onKey('RIGHT'), true);
  assert.equal(page.mode, 'list');
});
