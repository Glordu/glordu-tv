// Preferences chosen on this TV in Settings. Stored on the device only, so
// personal choices like the location never reach the public config.
//
//   locationMode    "auto" (from the internet connection) or "manual"
//   manualLocation  { name, region, country, latitude, longitude, timezone }
//   timezone        "tv" (the TV's own setting), "location", or an IANA zone
//   units           "celsius" | "fahrenheit" | null (use config.json)
//   clock           "24h" | "12h" | null (use config.json)
(function () {
  'use strict';

  const GTV = window.GTV;
  const KEY = 'gtv:prefs';
  const DEFAULTS = {
    locationMode: 'auto',
    manualLocation: null,
    timezone: 'tv',
    units: null,
    clock: null,
  };
  const listeners = [];

  function load() {
    try {
      return JSON.parse(localStorage.getItem(KEY)) || {};
    } catch (err) {
      return {};
    }
  }

  let values = load();

  GTV.prefs = {
    get: function (key) {
      return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : DEFAULTS[key];
    },

    set: function (key, value) {
      values[key] = value;
      try {
        localStorage.setItem(KEY, JSON.stringify(values));
      } catch (err) {
        console.warn('Could not save preferences', err);
      }
      listeners.slice().forEach((fn) => fn(key, value));
    },

    // fn(key, value) after every change. Returns an unsubscribe function.
    onChange: function (fn) {
      listeners.push(fn);
      return function () {
        const i = listeners.indexOf(fn);
        if (i > -1) listeners.splice(i, 1);
      };
    },
  };
})();
