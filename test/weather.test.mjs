// The shared weather service: turning Open-Meteo's response into days with
// their hours, and hiding readings that are too old.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp, settle } from './helpers/app.mjs';

const HOUR = 3600;
const DAY = 24 * HOUR;

// An Open-Meteo-like response: daily times are local midnights (seconds);
// hourly values run from the first midnight to the end of the last day.
function response(dayStarts, currentTime) {
  const end = dayStarts[dayStarts.length - 1] + DAY;
  const hours = [];
  for (let t = dayStarts[0]; t < end; t += HOUR) hours.push(t);
  const fill = (v) => dayStarts.map(() => v);
  return {
    timezone: 'Europe/Madrid',
    current: { time: currentTime, temperature_2m: 21, apparent_temperature: 20, weather_code: 2, is_day: 1 },
    daily: {
      time: dayStarts,
      weather_code: fill(3),
      temperature_2m_max: fill(23),
      temperature_2m_min: fill(15),
      precipitation_probability_max: fill(40),
      precipitation_sum: fill(1.5),
      wind_speed_10m_max: fill(20),
      sunrise: dayStarts.map((t) => t + 7 * HOUR),
      sunset: dayStarts.map((t) => t + 18 * HOUR),
    },
    hourly: {
      time: hours,
      temperature_2m: hours.map((_, i) => 15 + (i % 24) / 3),
      precipitation_probability: hours.map((_, i) => i % 100),
      precipitation: hours.map(() => 0),
      weather_code: hours.map(() => 1),
      is_day: hours.map(() => 1),
    },
  };
}

async function weatherFor(body) {
  const win = loadApp(['js/prefs.js', 'js/weather.js'], {
    GTV: {
      config: { weather: {} },
      location: { get: () => Promise.resolve({ latitude: 41.39, longitude: 2.17 }), onChange() {} },
      data: { fetchJson: () => Promise.resolve(body) },
    },
  });
  let received;
  win.GTV.weather.subscribe((data) => (received = data));
  for (let i = 0; i < 3; i++) await settle();
  return received;
}

test('hours are grouped under their day, including a 23-hour daylight-saving day', async () => {
  const now = Math.floor(Date.now() / 1000);
  const start = now - (now % DAY);
  // Day 2 is 23 hours long, as when clocks go forward.
  const days = [start, start + DAY, start + 2 * DAY, start + 3 * DAY - HOUR];
  const data = await weatherFor(response(days, now));
  assert.deepEqual(Array.from(data.daily.map((d) => d.hours.length)), [24, 24, 23, 24]);
  assert.equal(data.daily[1].hours[0].time, days[1] * 1000);
});

test('daily and current values are parsed, with times in milliseconds', async () => {
  const now = Math.floor(Date.now() / 1000);
  const start = now - (now % DAY);
  const data = await weatherFor(response([start, start + DAY], now));
  assert.equal(data.timezone, 'Europe/Madrid');
  assert.equal(data.current.temperature, 21);
  assert.equal(data.current.feelsLike, 20);
  assert.equal(data.daily[0].rainChance, 40);
  assert.equal(data.daily[0].sunrise, (start + 7 * HOUR) * 1000);
});

test('a reading older than 3 hours is hidden instead of shown stale', async () => {
  const now = Math.floor(Date.now() / 1000);
  const start = now - (now % DAY);
  const data = await weatherFor(response([start, start + DAY], now - 4 * HOUR));
  assert.equal(data, null);
});
