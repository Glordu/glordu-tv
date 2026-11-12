// Which location wins: a city chosen in Settings, then the automatic
// (IP-based) one, then config.json's fallback.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp, settle } from './helpers/app.mjs';

const BARCELONA = { city: 'Barcelona', region: 'Catalonia', country: 'Spain', latitude: '41.39', longitude: '2.17', timezone: 'Europe/Madrid' };
const LISBON = { name: 'Lisbon', region: 'Lisbon District', country: 'Portugal', latitude: 38.72, longitude: -9.14, timezone: 'Europe/Lisbon' };
const FALLBACK = { name: 'Fallback City', timezone: 'UTC', latitude: 10, longitude: 20 };

function app(request) {
  return loadApp(['js/prefs.js', 'js/location.js'], {
    GTV: { config: { weather: FALLBACK }, data: { request: request } },
  });
}

test('automatic location comes from the IP lookup', async () => {
  const win = app(() => Promise.resolve(BARCELONA));
  const loc = await win.GTV.location.get();
  assert.equal(loc.source, 'auto');
  assert.equal(loc.name, 'Barcelona');
  assert.equal(loc.timezone, 'Europe/Madrid');
});

test('when the IP lookups fail, config.json is the fallback', async () => {
  const win = app(() => Promise.reject(new Error('offline')));
  const loc = await win.GTV.location.get();
  assert.equal(loc.source, 'config');
  assert.equal(loc.name, 'Fallback City');
});

test('a city chosen in Settings wins over automatic', async () => {
  const win = app(() => Promise.resolve(BARCELONA));
  win.GTV.prefs.set('manualLocation', LISBON);
  win.GTV.prefs.set('locationMode', 'manual');
  const loc = await win.GTV.location.get();
  assert.equal(loc.source, 'manual');
  assert.equal(loc.name, 'Lisbon');
});

// Choosing a city sets two prefs in a row; the lookup started by the first
// used to finish last and put the old city back.
test('choosing a city is not undone by the lookup it replaced', async () => {
  const win = app(() => Promise.resolve(BARCELONA));
  await win.GTV.location.get();
  const heard = [];
  win.GTV.location.onChange((loc) => heard.push(loc && loc.name));
  win.GTV.prefs.set('manualLocation', LISBON);
  win.GTV.prefs.set('locationMode', 'manual');
  for (let i = 0; i < 5; i++) await settle();
  assert.equal(win.GTV.location.current().name, 'Lisbon');
  assert.ok(heard.length > 0);
  assert.ok(heard.every((name) => name === 'Lisbon'), 'listeners only hear Lisbon, heard: ' + heard.join(', '));
});

test('the automatic location is looked up once and cached', async () => {
  let lookups = 0;
  const win = app(() => {
    lookups++;
    return Promise.resolve(BARCELONA);
  });
  await win.GTV.location.get();
  win.GTV.prefs.set('locationMode', 'auto'); // forces a fresh resolve
  await win.GTV.location.get();
  assert.equal(lookups, 1);
});
