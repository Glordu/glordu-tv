// Weather shared by every module: current conditions plus daily weather from
// PAST_DAYS ago to FORECAST_DAYS ahead, from Open-Meteo (free, no API key),
// for the location from GTV.location. One request serves the slideshow
// corner and the Weather page. Units come from Settings, else the "weather"
// section of config.json:
//   units                 "celsius" (default) or "fahrenheit"
//   refreshMinutes        how often to re-fetch while something is listening
//
// Modules call GTV.weather.subscribe(fn); fn gets
//   { timezone, current: { temperature, feelsLike, code, isDay, time },
//     daily: [{ time, code, max, min, rainChance, rain, wind, sunrise, sunset,
//               hours: [{ time, temperature, rainChance, rain, code, isDay }] }] }
// (times are JS millisecond timestamps, day times at local midnight; rain in
// mm or inches, wind in km/h or mph), or null when weather is unavailable.
(function () {
  'use strict';

  const GTV = window.GTV;
  const STALE_MS = 3 * 60 * 60 * 1000; // hide readings older than this
  const PAST_DAYS = 28;
  const FORECAST_DAYS = 16; // Open-Meteo's maximum
  const listeners = [];
  let latest = null;
  let timer = null;

  function settings() {
    return (GTV.config && GTV.config.weather) || {};
  }

  function units() {
    return GTV.prefs.get('units') || settings().units || 'celsius';
  }

  // Two decimals (about 1 km) is plenty for weather.
  function coord(value) {
    return Math.round(value * 100) / 100;
  }

  function forecastUrl(loc) {
    const imperial = units() === 'fahrenheit';
    return (
      'https://api.open-meteo.com/v1/forecast' +
      '?latitude=' + coord(loc.latitude) +
      '&longitude=' + coord(loc.longitude) +
      '&current=temperature_2m,apparent_temperature,weather_code,is_day' +
      '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,wind_speed_10m_max,sunrise,sunset' +
      '&hourly=temperature_2m,precipitation_probability,precipitation,weather_code,is_day' +
      '&past_days=' + PAST_DAYS + '&forecast_days=' + FORECAST_DAYS +
      '&timezone=auto&timeformat=unixtime' +
      '&temperature_unit=' + (imperial ? 'fahrenheit' : 'celsius') +
      '&precipitation_unit=' + (imperial ? 'inch' : 'mm') +
      '&wind_speed_unit=' + (imperial ? 'mph' : 'kmh')
    );
  }

  function column(d, name, i) {
    return d[name] ? d[name][i] : null;
  }

  function seconds(value) {
    return value == null ? null : value * 1000;
  }

  // Hours grouped under the day they fall in. Days are normally 24 hours,
  // but 23 or 25 on daylight-saving changes, so group by time, not by count.
  function attachHours(daily, h) {
    if (!h || !h.time) return;
    let next = 0;
    daily.forEach((day, i) => {
      const end = i + 1 < daily.length ? daily[i + 1].time : Infinity;
      day.hours = [];
      while (next < h.time.length && h.time[next] * 1000 < end) {
        if (h.time[next] * 1000 >= day.time) {
          day.hours.push({
            time: h.time[next] * 1000,
            temperature: column(h, 'temperature_2m', next),
            rainChance: column(h, 'precipitation_probability', next),
            rain: column(h, 'precipitation', next),
            code: column(h, 'weather_code', next),
            isDay: column(h, 'is_day', next) === 1,
          });
        }
        next++;
      }
    });
  }

  function parse(body) {
    const c = body.current;
    const d = body.daily;
    const daily = d.time.map((t, i) => ({
      time: t * 1000,
      code: d.weather_code[i],
      max: d.temperature_2m_max[i],
      min: d.temperature_2m_min[i],
      rainChance: column(d, 'precipitation_probability_max', i),
      rain: column(d, 'precipitation_sum', i),
      wind: column(d, 'wind_speed_10m_max', i),
      sunrise: seconds(column(d, 'sunrise', i)),
      sunset: seconds(column(d, 'sunset', i)),
      hours: [],
    }));
    attachHours(daily, body.hourly);
    return {
      timezone: body.timezone || null,
      current: { temperature: c.temperature_2m, feelsLike: c.apparent_temperature, code: c.weather_code, isDay: c.is_day === 1, time: c.time * 1000 },
      daily: daily,
    };
  }

  function publish(data) {
    latest = data;
    listeners.slice().forEach((fn) => fn(data));
  }

  function refresh() {
    GTV.location
      .get()
      .then((loc) => {
        if (!loc) return null;
        return GTV.data.fetchJson(forecastUrl(loc));
      })
      .then((body) => {
        if (!body) {
          publish(null);
          return;
        }
        const data = parse(body);
        // A cached copy from long ago is worse than showing nothing.
        publish(Date.now() - data.current.time < STALE_MS ? data : null);
      })
      .catch((err) => {
        console.warn('Weather unavailable', err);
        publish(null);
      });
  }

  // Meaning of each WMO weather code, and which icon draws it.
  function kind(code) {
    if (code === 0) return 'clear';
    if (code === 1 || code === 2) return 'partly';
    if (code === 3) return 'cloudy';
    if (code === 45 || code === 48) return 'fog';
    if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
    if (code >= 95) return 'storm';
    if (code >= 51) return 'rain';
    return 'cloudy';
  }

  const LABELS = {
    clear: 'Clear',
    partly: 'Partly cloudy',
    cloudy: 'Cloudy',
    fog: 'Fog',
    rain: 'Rain',
    snow: 'Snow',
    storm: 'Thunderstorm',
  };

  // Filled icons from Google's Material Symbols (Rounded, weight 400), the
  // closest match to the Chromecast's. Apache License 2.0:
  // https://github.com/google/material-design-icons. Inline SVG rather than
  // emoji (the TV has no colour emoji font) or a CDN (works offline).
  const PATHS = {
    sun: 'M458.5-778.63Q450-787.25 450-800v-90q0-12.75 8.68-21.38 8.67-8.62 21.5-8.62 12.82 0 21.32 8.62 8.5 8.63 8.5 21.38v90q0 12.75-8.68 21.37-8.67 8.63-21.5 8.63-12.82 0-21.32-8.63ZM685-685q-9-9-9-21.1 0-12.1 9-20.9l63-64q9.07-9 21.53-9 12.47 0 21.47 9 9 9 9 21t-9 21l-64 64q-9 9-21 9t-21-9Zm115 235q-12.75 0-21.37-8.68-8.63-8.67-8.63-21.5 0-12.82 8.63-21.32 8.62-8.5 21.37-8.5h90q12.75 0 21.38 8.68 8.62 8.67 8.62 21.5 0 12.82-8.62 21.32-8.63 8.5-21.38 8.5h-90ZM458.5-48.63Q450-57.25 450-70v-90q0-12.75 8.68-21.38 8.67-8.62 21.5-8.62 12.82 0 21.32 8.62 8.5 8.63 8.5 21.38v90q0 12.75-8.68 21.37-8.67 8.63-21.5 8.63-12.82 0-21.32-8.63ZM233-685l-64-63q-9-8.87-9-21.43 0-12.57 9.39-21.57 8.61-9 20.61-9t21 9l64 64q9 9 9 21t-9 21q-9.27 8-21.64 8-12.36 0-20.36-8Zm516 516-64-64q-9-8.8-9-20.9 0-12.1 9-21.1 8.25-8 20.63-8 12.37 0 21.37 8l65 63q9 9 8.63 21.6-.37 12.61-8.53 21.5-8.89 8.9-21.5 8.9-12.6 0-21.6-9ZM70-450q-12.75 0-21.37-8.68-8.63-8.67-8.63-21.5 0-12.82 8.63-21.32Q57.25-510 70-510h90q12.75 0 21.38 8.68 8.62 8.67 8.62 21.5 0 12.82-8.62 21.32-8.63 8.5-21.38 8.5H70Zm99 280.61q-9-8.61-9-20.61t9-21l64-64q8.25-8 20.63-8 12.37 0 21.37 8.25 9 9 9 21.37 0 12.38-9 21.38l-63 63q-8.87 9-21.43 9-12.57 0-21.57-9.39ZM310-310q-70-70-70-170t70-170q70-70 170-70t170 70q70 70 70 170t-70 170q-70 70-170 70t-170-70Z',
    moon: 'M484-80q-84 0-157.5-32t-128-86.5Q144-253 112-326.5T80-484q0-132 77.5-238T361-868q17-5 31 5t12 27q-7 88 23.5 169.5T521-522q63 63 145 94t170 24q17-2 26.5 13t4.5 32q-40 125-145.5 202T484-80Z',
    partlyDay: 'm749-169-63-63q-9-9-9-21.5t9-21.5q9-9 21.5-9t21.5 9l63 63q9 9 9 21.5t-9 21.5q-9 9-21.5 9t-21.5-9Zm-509-11q-58 0-99-41t-41-99q0-58 41-99t99-41q39 0 71.5 21t47.5 57l18 41h44q33 0 56 24t23 57q0 33-23.5 56.5T420-180H240Zm318-73q0-61-41-104.5T416-401q-20-56-68-89t-108-30q14-88 82.5-144T480-720q100 0 170 70t70 170q0 78-44.5 140T558-253Zm242-197q-13 0-21.5-8.5T770-480q0-13 8.5-21.5T800-510h90q13 0 21.5 8.5T920-480q0 13-8.5 21.5T890-450h-90ZM233-685l-64-64q-9-9-9-21t9-21q9-9 21-9t21 9l64 64q9 9 9 21t-9 21q-9 9-21 9t-21-9Zm452 0q-9-9-9-21.5t9-21.5l63-63q9-9 21.5-9t21.5 9q9 9 9 21t-9 21l-64 64q-9 9-21 9t-21-9Zm-226.5-93.5Q450-787 450-800v-90q0-13 8.5-21.5T480-920q13 0 21.5 8.5T510-890v90q0 13-8.5 21.5T480-770q-13 0-21.5-8.5Z',
    partlyNight: 'M240-450q51 0 93.5 27.5T396-347l7 17h19q45 0 76.5 32t31.5 78q0 46-32.5 78T420-110H240q-70 0-120-50T70-280q0-71 50-120.5T240-450Zm321-72q66 66 145.5 93.5T877-407q8-1 14 2.5t11 8.5q5 5 6.5 12t-.5 15q-38 130-142.5 209.5T524-80h-8q35-24 54.5-61t19.5-79q0-66-42-113t-105-55q-30-56-84-89t-119-33q-32 0-62.5 8.5T120-476v-8q0-142 79-240.5T408-866q8-2 15.5-1t12.5 6q5 5 9 11t3 14q-5 91 21 169.5T561-522Z',
    cloudy: 'M251-160q-88 0-149.5-61.5T40-371q0-78 50-137t127-71q20-97 94-158.5T482-799q112 0 189 81.5T748-522v24q72-2 122 46.5T920-329q0 69-50 119t-119 50H251Z',
    fog: 'M720-205q-14 0-24.5-10.5T685-240q0-14 10.5-24.5T720-275q14 0 24.5 10.5T755-240q0 14-10.5 24.5T720-205ZM280-80q-14 0-24.5-10.5T245-115q0-14 10.5-24.5T280-150q14 0 24.5 10.5T315-115q0 14-10.5 24.5T280-80Zm-40-125q-14 0-24.5-10.5T205-240q0-14 10.5-24.5T240-275h360q14 0 24.5 10.5T635-240q0 14-10.5 24.5T600-205H240ZM400-80q-14 0-24.5-10.5T365-115q0-14 10.5-24.5T400-150h280q14 0 24.5 10.5T715-115q0 14-10.5 24.5T680-80H400ZM290-340q-87 0-148.5-61.5T80-550q0-79 56.5-141T277-759q32-56 84.5-88.5T480-880q91 0 152.5 57.5T708-680q79 4 125.5 53.5T880-510q0 70-49.5 120T710-340H290Z',
    rain: 'M558-83q-11 5-23.5 1T517-97l-69-138q-5-11-1.5-23.5T461-276q11-5 23.5-1t17.5 15l69 138q5 11 1.5 23.5T558-83Zm240-1q-11 5-23.5 1T757-98l-69-138q-5-11-1.5-23.5T701-277q11-5 23.5-1t17.5 15l69 138q5 11 1.5 23.5T798-84Zm-480 0q-11 5-23.5 1.5T277-97l-69-138q-5-11-1-23.5t15-17.5q11-5 23.5-1.5T263-263l69 139q5 11 1 23t-15 17Zm-28-256q-87 0-148.5-61.5T80-550q0-79 56.5-141T277-759q32-56 84.5-88.5T480-880q91 0 152.5 57.5T708-680q79 4 125.5 53.5T880-510q0 70-49.5 120T710-340H290Z',
    snow: 'M231.5-221.64q-11.5-11.64-11.5-28.5t11.64-28.36q11.64-11.5 28.5-11.5t28.36 11.64q11.5 11.64 11.5 28.5t-11.64 28.36q-11.64 11.5-28.5 11.5t-28.36-11.64Zm120 130q-11.5-11.64-11.5-28.5t11.64-28.36q11.64-11.5 28.5-11.5t28.36 11.64q11.5 11.64 11.5 28.5T408.36-91.5Q396.72-80 379.86-80T351.5-91.64Zm120-130q-11.5-11.64-11.5-28.5t11.64-28.36q11.64-11.5 28.5-11.5t28.36 11.64q11.5 11.64 11.5 28.5t-11.64 28.36q-11.64 11.5-28.5 11.5t-28.36-11.64Zm240 0q-11.5-11.64-11.5-28.5t11.64-28.36q11.64-11.5 28.5-11.5t28.36 11.64q11.5 11.64 11.5 28.5t-11.64 28.36q-11.64 11.5-28.5 11.5t-28.36-11.64Zm-120 130q-11.5-11.64-11.5-28.5t11.64-28.36q11.64-11.5 28.5-11.5t28.36 11.64q11.5 11.64 11.5 28.5T648.36-91.5Q636.72-80 619.86-80T591.5-91.64ZM290-380q-86.86 0-148.43-61.52Q80-503.04 80-589.83 80-669 136.5-731 193-793 277-799q32-56 84.5-88.5T480.42-920q90.58 0 152.08 57.5Q694-805 708-720q79 4 125.5 53.5T880-550.38Q880-480 830.42-430 780.83-380 710-380H290Z',
    storm: 'M327-40q-10 0-15.5-8T309-65l27-75h-65q-4 0-6.5-3t-.5-7l41-115q2-7 7.5-11t13.5-4h61q8 0 12.5 6.5T401-259l-34 79h68q5 0 6.5 4t-1.5 8L346-47q-3 4-7 5.5T327-40Zm270-40q-10 0-15.5-8t-2.5-17l19-55h-67q-4 0-6.5-3t-.5-7l33-95q2-7 8-11t14-4h61q8 0 12.5 6.5T654-259l-26 59h66q5 0 7 4t-1 8L616-87q-1 1-19 7ZM290-340q-87 0-148.5-61.5T80-550q0-79 56.5-141T277-759q32-56 84.5-88.5T480-880q91 0 152.5 57.5T708-680q79 4 125.5 53.5T880-510q0 70-49.5 120T710-340H290Z',
  };

  function icon(code, isDay) {
    let name = kind(code);
    if (name === 'clear') name = isDay ? 'sun' : 'moon';
    else if (name === 'partly') name = isDay ? 'partlyDay' : 'partlyNight';
    return (
      // width/height keep it text-sized even if the stylesheet fails to load.
      '<svg class="weather-icon" width="1em" height="1em" viewBox="0 -960 960 960" fill="currentColor" aria-hidden="true">' +
      '<path d="' + PATHS[name] + '"/></svg>'
    );
  }

  // A new location or unit in Settings refetches straight away.
  GTV.location.onChange(() => {
    if (timer) refresh();
  });
  GTV.prefs.onChange((key) => {
    if (key === 'units' && timer) refresh();
  });

  GTV.weather = {
    // Calls fn now (if there's data) and after every refresh. Returns an
    // unsubscribe function. Fetching only runs while someone is subscribed.
    subscribe: function (fn) {
      listeners.push(fn);
      if (latest) fn(latest);
      if (!timer) {
        refresh();
        const minutes = settings().refreshMinutes || 30;
        timer = setInterval(refresh, minutes * 60 * 1000);
      }
      return function () {
        const i = listeners.indexOf(fn);
        if (i > -1) listeners.splice(i, 1);
        if (!listeners.length) {
          clearInterval(timer);
          timer = null;
        }
      };
    },

    // "celsius" or "fahrenheit", as currently in effect.
    units: units,
    icon: icon,
    label: function (code) {
      return LABELS[kind(code)];
    },
    formatTemp: function (value) {
      return Math.round(value) + '°';
    },
  };
})();
