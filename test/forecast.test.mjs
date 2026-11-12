// The Weather page's navigation: the day strip, the hours row, Back, and
// "now" moving forward as the hours pass.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp } from './helpers/app.mjs';

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

// Weather data in UTC: 2 days back to 3 days ahead, 24 hours each.
function weatherData() {
  const today = Date.now() - (Date.now() % DAY);
  const daily = [];
  for (let d = -2; d <= 3; d++) {
    const time = today + d * DAY;
    const hours = [];
    for (let h = 0; h < 24; h++) hours.push({ time: time + h * HOUR, temperature: 10 + h / 2, rainChance: h, rain: 0, code: 1, isDay: true });
    daily.push({ time: time, code: 1, max: 22, min: 10, rainChance: 30, rain: 0, wind: 10, sunrise: time + 7 * HOUR, sunset: time + 18 * HOUR, hours: hours });
  }
  return { timezone: 'UTC', current: { temperature: 18, feelsLike: 17, code: 1, isDay: true, time: Date.now() }, daily: daily };
}

function page() {
  const win = loadApp(['modules/forecast.js'], {
    GTV: {
      register(def) {
        this.defs = this.defs || {};
        this.defs[def.id] = def;
      },
      weather: {
        subscribe: (fn) => {
          fn(weatherData());
          return () => {};
        },
        icon: () => '<svg></svg>',
        label: () => 'Clear',
        formatTemp: (t) => Math.round(t) + '°',
        units: () => 'celsius',
      },
      location: { onChange: () => () => {}, get: () => Promise.resolve(null), current: () => null, describe: () => '' },
      clock: { format: (d) => String(d.getUTCHours()).padStart(2, '0') + ':00' },
    },
  });
  const forecast = win.GTV.defs.weather.mount(win.document.createElement('div'), {});
  return { win, forecast };
}

const hourOfDay = (forecast, index) => forecast.hours[index].inDay;

test('the page starts on now, on the day strip', () => {
  const { forecast } = page();
  assert.equal(forecast.focus, 'days');
  assert.equal(forecast.hour, forecast.now);
  assert.equal(forecast.hours[forecast.now].day, forecast.today);
});

test('changing day lands on the current time of day, whatever hour was picked', () => {
  const { forecast } = page();
  forecast.onKey('UP'); // to the hours row
  forecast.onKey('RIGHT');
  forecast.onKey('RIGHT');
  forecast.onKey('RIGHT');
  forecast.onKey('DOWN'); // back to the strip
  forecast.onKey('RIGHT'); // tomorrow
  assert.equal(forecast.hours[forecast.hour].day, forecast.today + 1);
  assert.equal(hourOfDay(forecast, forecast.hour), hourOfDay(forecast, forecast.now));
  forecast.onKey('LEFT'); // today: now itself
  assert.equal(forecast.hour, forecast.now);
});

test('after a day change the selected hour is the first one in the row', () => {
  const { forecast } = page();
  forecast.onKey('UP');
  for (let i = 0; i < 8; i++) forecast.onKey('RIGHT');
  forecast.onKey('DOWN');
  forecast.onKey('RIGHT');
  assert.equal(forecast.windowStart, forecast.hour);
});

test('the hours row runs across midnight into the next day', () => {
  const { forecast } = page();
  forecast.onKey('UP');
  const steps = 24 - hourOfDay(forecast, forecast.now);
  for (let i = 0; i < steps; i++) forecast.onKey('RIGHT');
  assert.equal(forecast.hours[forecast.hour].day, forecast.today + 1);
  assert.equal(hourOfDay(forecast, forecast.hour), 0);
});

test('up and down move between the rows, then leave the page', () => {
  const { forecast } = page();
  assert.equal(forecast.onKey('DOWN'), false, 'down from the strip leaves the page');
  assert.equal(forecast.onKey('UP'), true);
  assert.equal(forecast.focus, 'hours');
  assert.equal(forecast.onKey('UP'), false, 'up from the hours row leaves the page');
});

test('Back returns to now on the strip, then lets the app handle it', () => {
  const { forecast } = page();
  forecast.onKey('UP');
  forecast.onKey('RIGHT');
  assert.equal(forecast.onBack(), true);
  assert.equal(forecast.focus, 'days');
  assert.equal(forecast.hour, forecast.now);
  assert.equal(forecast.onBack(), false);
});

test('when a new hour starts, now (and a selection on it) moves along', () => {
  const { win, forecast } = page();
  const before = forecast.now;
  const realNow = win.Date.now;
  win.Date.now = () => realNow() + HOUR;
  try {
    forecast.tickClock();
  } finally {
    win.Date.now = realNow;
  }
  assert.equal(forecast.now, before + 1);
  assert.equal(forecast.hour, before + 1);
});

test('a picked hour stays put when the hour changes', () => {
  const { win, forecast } = page();
  forecast.onKey('UP');
  forecast.onKey('RIGHT');
  forecast.onKey('RIGHT');
  const picked = forecast.hour;
  const realNow = win.Date.now;
  win.Date.now = () => realNow() + HOUR;
  try {
    forecast.tickClock();
  } finally {
    win.Date.now = realNow;
  }
  assert.equal(forecast.hour, picked);
});
