// The Settings page: moving through its rows, leaving the page only past
// the first or last one, Back, and choosing a city.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp } from './helpers/app.mjs';

const LISBON = { name: 'Lisbon', region: 'Lisbon District', country: 'Portugal', latitude: 38.72, longitude: -9.14, timezone: 'Europe/Lisbon' };

function settings() {
  const toasts = [];
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
