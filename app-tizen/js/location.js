// Where the TV is, for weather and the "location" time zone. In order:
//   1. a city picked in Settings (stored on the TV),
//   2. automatic: looked up from the TV's internet address, cached a day,
//   3. the "weather" section of config.json, as a fallback.
//
// A location is { name, region, country, latitude, longitude, timezone,
// source: "manual" | "auto" | "config" }.
(function () {
  'use strict';

  const GTV = window.GTV;
  const AUTO_KEY = 'gtv:auto-location';
  const AUTO_MAX_AGE_MS = 24 * 60 * 60 * 1000;

  // Free IP-location services that need no key; tried in order.
  const IP_LOOKUPS = [
    {
      url: 'https://get.geojs.io/v1/ip/geo.json',
      parse: (b) => ({
        name: b.city,
        region: b.region,
        country: b.country,
        latitude: parseFloat(b.latitude),
        longitude: parseFloat(b.longitude),
        timezone: b.timezone,
      }),
    },
    {
      url: 'https://ipwho.is/',
      parse: (b) =>
        b.success === false
          ? null
          : {
              name: b.city,
              region: b.region,
              country: b.country,
              latitude: b.latitude,
              longitude: b.longitude,
              timezone: b.timezone && b.timezone.id,
            },
    },
  ];

  const listeners = [];
  let pending = null; // promise of the current location
  let latest = null; // last resolved location, for synchronous readers
  // Bumped on every new lookup. Choosing a city changes two prefs in a row,
  // and the first lookup can finish after the second: only the newest counts.
  let generation = 0;

  function valid(loc) {
    return !!(loc && isFinite(loc.latitude) && isFinite(loc.longitude));
  }

  function readAuto() {
    try {
      return JSON.parse(localStorage.getItem(AUTO_KEY));
    } catch (err) {
      return null;
    }
  }

  function lookupIp(i) {
    if (i >= IP_LOOKUPS.length) return Promise.reject(new Error('No IP-location service answered'));
    const service = IP_LOOKUPS[i];
    return GTV.data
      .request(service.url)
      .then((body) => {
        const loc = service.parse(body);
        if (!valid(loc)) throw new Error('No location in answer');
        return loc;
      })
      .catch(() => lookupIp(i + 1));
  }

  function autoLocation() {
    const cached = readAuto();
    if (cached && Date.now() - cached.at < AUTO_MAX_AGE_MS) return Promise.resolve(cached.location);
    return lookupIp(0).then(
      (loc) => {
        try {
          localStorage.setItem(AUTO_KEY, JSON.stringify({ at: Date.now(), location: loc }));
        } catch (err) {
          // Not cached; it is looked up again next time.
        }
        return loc;
      },
      (err) => {
        console.warn('Automatic location failed', err);
        return cached ? cached.location : null; // an old guess beats none
      }
    );
  }

  function configLocation() {
    const cfg = GTV.config && GTV.config.weather;
    if (!cfg || cfg.latitude == null || cfg.longitude == null) return null;
    return {
      name: cfg.name || null,
      region: null,
      country: null,
      latitude: cfg.latitude,
      longitude: cfg.longitude,
      timezone: cfg.timezone || null,
    };
  }

  function resolve() {
    const manual = GTV.prefs.get('manualLocation');
    if (GTV.prefs.get('locationMode') === 'manual' && valid(manual)) {
      return Promise.resolve(Object.assign({}, manual, { source: 'manual' }));
    }
    return autoLocation().then((loc) => {
      if (valid(loc)) return Object.assign({}, loc, { source: 'auto' });
      const fallback = configLocation();
      return fallback ? Object.assign(fallback, { source: 'config' }) : null;
    });
  }

  function reset() {
    pending = null;
    GTV.location.get().then((loc) => {
      if (loc === latest) listeners.slice().forEach((fn) => fn(loc));
    });
  }

  GTV.location = {
    get: function () {
      if (!pending) {
        const mine = ++generation;
        pending = resolve().then((loc) => {
          if (mine !== generation) return GTV.location.get(); // superseded
          latest = loc;
          return loc;
        });
      }
      return pending;
    },

    // The last resolved location, or null if none yet.
    current: function () {
      return latest;
    },

    // fn(location) whenever the location may have changed.
    onChange: function (fn) {
      listeners.push(fn);
      return function () {
        const i = listeners.indexOf(fn);
        if (i > -1) listeners.splice(i, 1);
      };
    },

    // Forget the cached automatic guess and look it up again.
    redetect: function () {
      try {
        localStorage.removeItem(AUTO_KEY);
      } catch (err) {
        // Nothing cached to remove.
      }
      reset();
    },

    describe: function (loc) {
      if (!loc) return 'Unknown';
      return [loc.name, loc.region, loc.country]
        .filter((part, i, all) => part && all.indexOf(part) === i)
        .join(', ');
    },

    // City search by name, for Settings. Resolves to a list of locations.
    search: function (query) {
      const url =
        'https://geocoding-api.open-meteo.com/v1/search?count=8&language=en&format=json&name=' +
        encodeURIComponent(query);
      return GTV.data.request(url).then((body) =>
        (body.results || []).map((r) => ({
          name: r.name,
          region: r.admin1 || null,
          country: r.country || null,
          latitude: r.latitude,
          longitude: r.longitude,
          timezone: r.timezone || null,
        }))
      );
    },
  };

  GTV.prefs.onChange((key) => {
    if (key === 'locationMode' || key === 'manualLocation') reset();
  });
})();
