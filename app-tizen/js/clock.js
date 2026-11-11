// Time formatting that honours Settings: 24h/12h and the chosen time zone.
// "tv" uses the TV's own clock settings; anything else is an IANA zone,
// either picked directly or taken from the current location.
(function () {
  'use strict';

  const GTV = window.GTV;
  const formatters = {};

  function pad(n) {
    return n < 10 ? '0' + n : String(n);
  }

  function formatter(zone, mode) {
    const key = zone + '|' + mode;
    if (!formatters[key]) {
      formatters[key] = new Intl.DateTimeFormat('en-US', {
        hour: mode === '12h' ? 'numeric' : '2-digit',
        minute: '2-digit',
        hour12: mode === '12h',
        hourCycle: mode === '12h' ? undefined : 'h23',
        timeZone: zone,
      });
    }
    return formatters[key];
  }

  GTV.clock = {
    // "24h" or "12h": Settings first, then config.json's ambient clock.
    mode: function () {
      const pref = GTV.prefs.get('clock');
      if (pref) return pref;
      const ambient = GTV.config && GTV.config.modules && GTV.config.modules.ambient;
      return ambient && ambient.clock === '12h' ? '12h' : '24h';
    },

    // The IANA zone in use, or null for the TV's own setting.
    zone: function () {
      const pref = GTV.prefs.get('timezone');
      if (pref === 'tv') return null;
      if (pref === 'location') {
        const loc = GTV.location.current();
        return (loc && loc.timezone) || null;
      }
      return pref;
    },

    tvZone: function () {
      try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
      } catch (err) {
        return null;
      }
    },

    // "21:56" or "9:56" (no AM/PM, as on the Chromecast).
    format: function (date, zone) {
      const mode = GTV.clock.mode();
      zone = zone === undefined ? GTV.clock.zone() : zone;
      if (zone) {
        try {
          return formatter(zone, mode)
            .formatToParts(date)
            .filter((p) => p.type === 'hour' || p.type === 'minute' || p.type === 'literal')
            .map((p) => p.value)
            .join('')
            .trim();
        } catch (err) {
          // Unknown zone on this TV: fall back to its own clock.
        }
      }
      if (mode === '12h') return (date.getHours() % 12 || 12) + ':' + pad(date.getMinutes());
      return pad(date.getHours()) + ':' + pad(date.getMinutes());
    },
  };
})();
