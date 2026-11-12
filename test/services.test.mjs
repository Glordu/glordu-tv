// Shared services: remote data with its offline copy, the clock's formats
// and time zones, and what the weather request asks for.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp, settle } from './helpers/app.mjs';

// ---- Remote data -----------------------------------------------------------

const response = (body) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });

function dataApp(fetchImpl) {
  return loadApp(['js/settings.js', 'js/data.js'], { fetch: fetchImpl });
}

test('remote data is fetched live and saved for later', async () => {
  const win = dataApp(() => response({ hello: 'world' }));
  const body = await win.GTV.data.fetchJson('https://example.test/a.json');
  assert.equal(body.hello, 'world');
  assert.equal(win.GTV.data.log['https://example.test/a.json'].source, 'network');
});

test('when the network fails, the last saved copy is used', async () => {
  let online = true;
  const win = dataApp(() => (online ? response({ version: 1 }) : Promise.reject(new Error('offline'))));
  await win.GTV.data.fetchJson('https://example.test/a.json');
  online = false;
  const body = await win.GTV.data.fetchJson('https://example.test/a.json');
  assert.equal(body.version, 1);
  const entry = win.GTV.data.log['https://example.test/a.json'];
  assert.equal(entry.source, 'cache');
  assert.match(entry.error, /offline/);
});

test('a failed fetch is logged, saying whether the saved copy was used', async () => {
  let online = true;
  const win = dataApp(() => (online ? response({ version: 1 }) : Promise.reject(new Error('offline'))));
  await win.GTV.data.fetchJson('https://example.test/a.json?lat=41.39');
  online = false;
  await win.GTV.data.fetchJson('https://example.test/a.json?lat=41.39');
  await win.GTV.data.fetchJson('https://example.test/b.json').catch(() => {});
  assert.deepEqual(win.warnings, [
    "Couldn't fetch https://example.test/a.json: offline, using the saved copy",
    "Couldn't fetch https://example.test/b.json: offline",
  ]);
});

test('an HTTP error counts as a failure and falls back to the saved copy', async () => {
  let status = 200;
  const win = dataApp(() => Promise.resolve({ ok: status === 200, status: status, json: () => Promise.resolve({ version: 1 }) }));
  await win.GTV.data.fetchJson('https://example.test/a.json');
  status = 503;
  const body = await win.GTV.data.fetchJson('https://example.test/a.json');
  assert.equal(body.version, 1);
  assert.equal(win.GTV.data.log['https://example.test/a.json'].source, 'cache');
});

// A server that never answers: the request only ends when aborted.
const hang = (url, options) =>
  new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(new Error('aborted'))));

test('a request with no answer after 15 seconds gives up and uses the saved copy', async () => {
  let online = true;
  const win = loadApp(['js/settings.js', 'js/data.js'], {
    fetch: (url, options) => (online ? response({ version: 1 }) : hang(url, options)),
  }, { fakeTimers: true });
  await win.GTV.data.fetchJson('https://example.test/a.json');
  online = false;
  let body = null;
  win.GTV.data.fetchJson('https://example.test/a.json').then((b) => (body = b));
  win.tick(14 * 1000);
  await settle();
  assert.equal(body, null, 'still waiting at 14 s');
  win.tick(1000);
  await settle();
  assert.equal(body.version, 1);
  assert.match(win.GTV.data.log['https://example.test/a.json'].error, /aborted/);
});

test('an answer in time cancels the timeout', async () => {
  let aborted = false;
  const win = loadApp(['js/settings.js', 'js/data.js'], {
    fetch: (url, options) => {
      options.signal.addEventListener('abort', () => (aborted = true));
      return response({ ok: 1 });
    },
  }, { fakeTimers: true });
  await win.GTV.data.request('https://example.test/a.json');
  win.tick(60 * 1000);
  assert.equal(aborted, false);
});

test('with no network and nothing saved, the app starts on its built-in config', async () => {
  const win = dataApp(() => Promise.reject(new Error('offline')));
  const config = await win.GTV.data.loadConfig();
  assert.equal(config.startModule, 'ambient');
});

test('paths in the config resolve against the config URL', () => {
  const win = dataApp(() => response({}));
  assert.equal(win.GTV.data.resolve('images.json'), 'https://glordu.github.io/glordu-tv/v1/images.json');
});

// ---- Clock -------------------------------------------------------------------

function clockApp(prefs, config) {
  const win = loadApp(['js/prefs.js', 'js/clock.js'], {
    GTV: {
      config: config || {},
      location: { current: () => ({ timezone: 'Europe/Lisbon' }) },
    },
  });
  Object.keys(prefs || {}).forEach((k) => win.GTV.prefs.set(k, prefs[k]));
  return win;
}

const at = (win, iso) => new win.Date(iso);

test('the clock shows 24-hour time by default', () => {
  const win = clockApp({ timezone: 'UTC' });
  assert.equal(win.GTV.clock.format(at(win, '2026-11-12T09:05:00Z')), '09:05');
  assert.equal(win.GTV.clock.format(at(win, '2026-11-12T21:30:00Z')), '21:30');
});

test('12-hour time has no AM/PM, as on the Chromecast', () => {
  const win = clockApp({ timezone: 'UTC', clock: '12h' });
  assert.equal(win.GTV.clock.format(at(win, '2026-11-12T21:30:00Z')), '9:30');
  assert.equal(win.GTV.clock.format(at(win, '2026-11-12T00:15:00Z')), '12:15');
});

test('config.json sets the clock format unless Settings overrides it', () => {
  assert.equal(clockApp({}, { modules: { ambient: { clock: '12h' } } }).GTV.clock.mode(), '12h');
  assert.equal(clockApp({ clock: '24h' }, { modules: { ambient: { clock: '12h' } } }).GTV.clock.mode(), '24h');
});

test('a chosen time zone shifts the clock', () => {
  const win = clockApp({ timezone: 'Asia/Tokyo' });
  assert.equal(win.GTV.clock.format(at(win, '2026-11-12T09:05:00Z')), '18:05');
});

test('"same as location" uses the location\'s time zone', () => {
  const win = clockApp({ timezone: 'location' });
  assert.equal(win.GTV.clock.zone(), 'Europe/Lisbon');
  assert.equal(win.GTV.clock.format(at(win, '2026-07-01T09:05:00Z')), '10:05'); // Lisbon summer time
});

test('the TV setting means no zone override', () => {
  const win = clockApp({ timezone: 'tv' });
  assert.equal(win.GTV.clock.zone(), null);
});

// ---- Weather request -------------------------------------------------------

async function requestedUrl(prefs, location) {
  let url = null;
  const win = loadApp(['js/prefs.js', 'js/weather.js'], {
    GTV: {
      config: { weather: {} },
      location: { get: () => Promise.resolve(location), onChange() {} },
      data: {
        fetchJson: (u) => {
          url = u;
          return Promise.reject(new Error('stop here'));
        },
      },
    },
  });
  Object.keys(prefs).forEach((k) => win.GTV.prefs.set(k, prefs[k]));
  win.GTV.weather.subscribe(() => {});
  for (let i = 0; i < 3; i++) await settle();
  return url;
}

test('the weather request rounds the location to about 1 km', async () => {
  const url = await requestedUrl({}, { latitude: 41.388790123, longitude: 2.158990456 });
  assert.match(url, /latitude=41\.39&longitude=2\.16&/);
});

test('Celsius asks for metric rain and wind; Fahrenheit for inches and mph', async () => {
  const metric = await requestedUrl({}, { latitude: 1, longitude: 2 });
  assert.match(metric, /temperature_unit=celsius/);
  assert.match(metric, /precipitation_unit=mm/);
  assert.match(metric, /wind_speed_unit=kmh/);
  const imperial = await requestedUrl({ units: 'fahrenheit' }, { latitude: 1, longitude: 2 });
  assert.match(imperial, /temperature_unit=fahrenheit/);
  assert.match(imperial, /precipitation_unit=inch/);
  assert.match(imperial, /wind_speed_unit=mph/);
});

test('the request covers 4 weeks back to 16 days ahead, with hourly data', async () => {
  const url = await requestedUrl({}, { latitude: 1, longitude: 2 });
  assert.match(url, /past_days=28/);
  assert.match(url, /forecast_days=16/);
  assert.match(url, /hourly=temperature_2m,precipitation_probability/);
  assert.match(url, /apparent_temperature/);
});
