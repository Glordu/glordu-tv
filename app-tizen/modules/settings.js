// Settings: choices stored on this TV (see js/prefs.js), never in the public
// config. ▲▼ move between rows, ◀▶ change the value, OK on Location opens a
// city search that uses the TV's on-screen keyboard.
(function () {
  'use strict';

  const GTV = window.GTV;

  // Offered after "TV setting" and "Same as location". Any other zone still
  // works through "Same as location".
  const ZONES = [
    'UTC',
    'Europe/London',
    'Europe/Lisbon',
    'Europe/Madrid',
    'Europe/Paris',
    'Europe/Berlin',
    'Europe/Rome',
    'Europe/Athens',
    'Europe/Helsinki',
    'Europe/Istanbul',
    'Europe/Moscow',
    'Africa/Cairo',
    'Africa/Johannesburg',
    'Asia/Dubai',
    'Asia/Kolkata',
    'Asia/Bangkok',
    'Asia/Singapore',
    'Asia/Shanghai',
    'Asia/Tokyo',
    'Australia/Sydney',
    'Pacific/Auckland',
    'Pacific/Honolulu',
    'America/Los_Angeles',
    'America/Denver',
    'America/Chicago',
    'America/New_York',
    'America/Mexico_City',
    'America/Bogota',
    'America/Santiago',
    'America/Sao_Paulo',
    'America/Argentina/Buenos_Aires',
    'America/Montevideo',
  ];

  function make(tag, className, parent, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text != null) el.textContent = text;
    if (parent) parent.appendChild(el);
    return el;
  }

  function cycle(list, current, step) {
    const i = Math.max(0, list.indexOf(current));
    return list[(i + step + list.length) % list.length];
  }

  function zoneName(zone) {
    return zone.replace(/_/g, ' ');
  }

  function zoneLabel(pref, loc) {
    if (pref === 'tv') {
      const tv = GTV.clock.tvZone();
      return 'TV setting' + (tv ? ' (' + zoneName(tv) + ')' : '');
    }
    if (pref === 'location') {
      return 'Same as location' + (loc && loc.timezone ? ' (' + zoneName(loc.timezone) + ')' : '');
    }
    return zoneName(pref);
  }

  function Settings(root, ctx) {
    this.ctx = ctx;
    this.location = GTV.location.current();
    this.focus = 0;
    this.mode = 'list';
    this.results = [];
    this.resultEls = [];
    this.resultFocus = -1; // -1 is the search box
    this.searchToken = 0;
    this.dead = false;

    root.classList.add('settings');

    this.listView = make('div', 'settings-view', root);
    make('h1', null, this.listView, 'Settings');
    const rowsEl = make('div', 'settings-rows', this.listView);
    const about = make('div', 'settings-about', this.listView);
    make('h2', null, about, 'About');
    this.aboutEl = make('dl', null, about);

    this.searchView = make('div', 'settings-view is-hidden', root);
    make('h1', null, this.searchView, 'Choose a city');
    this.input = make('input', 'settings-input', this.searchView);
    this.input.type = 'text';
    this.input.placeholder = 'City name';
    this.input.setAttribute('autocomplete', 'off');
    this.searchStatus = make('p', 'settings-status', this.searchView);
    this.resultsEl = make('div', 'settings-results', this.searchView);

    this.rows = this.defineRows();
    this.rowEls = this.rows.map((row) => {
      const el = make('div', 'settings-row', rowsEl);
      make('div', 'settings-label', el, row.label);
      const body = make('div', 'settings-body', el);
      row.valueEl = make('div', 'settings-value', body);
      row.noteEl = make('div', 'settings-note', body);
      return el;
    });

    this.unsubscribe = [
      GTV.prefs.onChange(() => this.render()),
      GTV.location.onChange((loc) => {
        this.location = loc;
        this.render();
      }),
    ];
    GTV.location.get().then((loc) => {
      if (this.dead) return;
      this.location = loc;
      this.render();
    });
    // Keeps the time preview under "Time zone" current.
    this.timer = setInterval(() => this.render(), 15000);
    this.render();
  }

  Settings.prototype.defineRows = function () {
    const self = this;
    const isAuto = () => GTV.prefs.get('locationMode') !== 'manual';
    return [
      {
        label: 'Location',
        value: function () {
          const where = self.location ? GTV.location.describe(self.location) : 'Detecting…';
          return isAuto() ? 'Automatic · ' + where : where;
        },
        note: function () {
          if (!isAuto()) return 'Chosen city. ◀▶ switches to automatic, OK searches again.';
          if (self.location && self.location.source === 'config') {
            return "Couldn't detect it, so this is the default from config.json. OK to pick a city.";
          }
          if (!self.location) return 'Looking it up from your internet connection…';
          const back = GTV.prefs.get('manualLocation') ? '◀▶ switches to your chosen city, ' : '';
          return 'Detected from your internet connection. ' + back + 'OK picks a city.';
        },
        change: function () {
          if (isAuto() && !GTV.prefs.get('manualLocation')) {
            self.openSearch();
            return;
          }
          GTV.prefs.set('locationMode', isAuto() ? 'manual' : 'auto');
        },
        enter: function () {
          self.openSearch();
        },
      },
      {
        label: 'Time zone',
        value: () => zoneLabel(GTV.prefs.get('timezone'), self.location),
        note: function () {
          const tv = GTV.prefs.get('timezone') === 'tv' ? ' · change it on the TV under Settings → General → Time' : '';
          return 'Clock shows ' + GTV.clock.format(new Date()) + tv;
        },
        change: (step) => GTV.prefs.set('timezone', cycle(['tv', 'location'].concat(ZONES), GTV.prefs.get('timezone'), step)),
      },
      {
        label: 'Temperature',
        value: () => (GTV.weather.units() === 'fahrenheit' ? 'Fahrenheit (°F)' : 'Celsius (°C)'),
        change: () => GTV.prefs.set('units', GTV.weather.units() === 'fahrenheit' ? 'celsius' : 'fahrenheit'),
      },
      {
        label: 'Clock',
        value: () => (GTV.clock.mode() === '12h' ? '12-hour' : '24-hour'),
        change: () => GTV.prefs.set('clock', GTV.clock.mode() === '12h' ? '24h' : '12h'),
      },
    ];
  };

  Settings.prototype.render = function () {
    this.listView.classList.toggle('is-hidden', this.mode !== 'list');
    this.searchView.classList.toggle('is-hidden', this.mode !== 'search');
    this.rows.forEach((row, i) => {
      row.valueEl.textContent = row.value();
      row.noteEl.textContent = row.note ? row.note() : '';
      this.rowEls[i].classList.toggle('is-focused', i === this.focus);
    });
    this.input.classList.toggle('is-focused', this.resultFocus === -1);
    this.resultEls.forEach((el, i) => el.classList.toggle('is-focused', i === this.resultFocus));
    const focused = this.resultEls[this.resultFocus];
    if (focused && focused.scrollIntoView) focused.scrollIntoView({ block: 'nearest' });
  };

  // Moving between rows only moves the highlight; the values don't change.
  Settings.prototype.renderFocus = function () {
    this.rowEls.forEach((el, i) => el.classList.toggle('is-focused', i === this.focus));
  };

  Settings.prototype.openSearch = function () {
    this.mode = 'search';
    this.input.value = '';
    this.setResults([]);
    this.searchStatus.textContent = '';
    this.resultFocus = -1;
    this.render();
    this.input.focus(); // brings up the TV's on-screen keyboard
  };

  Settings.prototype.closeSearch = function () {
    this.searchToken++; // ignore any search still in flight
    this.input.blur();
    this.mode = 'list';
    this.render();
  };

  Settings.prototype.setResults = function (results) {
    this.results = results;
    this.resultsEl.innerHTML = '';
    this.resultEls = results.map((r) => {
      const el = make('div', 'settings-result', this.resultsEl);
      make('div', 'settings-result-name', el, r.name);
      const where = [r.region, r.country].filter(Boolean).join(', ');
      make('div', 'settings-note', el, where + (r.timezone ? ' · ' + zoneName(r.timezone) : ''));
      return el;
    });
  };

  Settings.prototype.runSearch = function () {
    const query = this.input.value.trim();
    if (query.length < 2) {
      this.searchStatus.textContent = 'Type at least two letters, then press OK.';
      return;
    }
    const token = ++this.searchToken;
    this.searchStatus.textContent = 'Searching…';
    GTV.location.search(query).then(
      (results) => {
        if (this.dead || token !== this.searchToken) return;
        this.setResults(results);
        this.searchStatus.textContent = results.length ? '' : 'No cities called "' + query + '". Try another spelling.';
        if (results.length) {
          this.resultFocus = 0;
          this.input.blur();
        }
        this.render();
      },
      () => {
        if (this.dead || token !== this.searchToken) return;
        this.searchStatus.textContent = "Couldn't search. Check the TV's internet connection.";
      }
    );
  };

  Settings.prototype.pick = function (index) {
    const choice = this.results[index];
    if (!choice) return;
    GTV.prefs.set('manualLocation', choice);
    GTV.prefs.set('locationMode', 'manual');
    this.closeSearch();
    this.ctx.toast('Location set to ' + GTV.location.describe(choice));
  };

  Settings.prototype.onSearchKey = function (key) {
    const inBox = this.resultFocus === -1;
    switch (key) {
      case 'ENTER':
        if (!inBox) this.pick(this.resultFocus);
        else if (document.activeElement !== this.input) this.input.focus();
        else this.runSearch();
        return true;
      case 'DOWN':
        if (this.resultFocus < this.results.length - 1) {
          this.resultFocus++;
          this.input.blur();
          this.render();
        }
        return true;
      case 'UP':
        if (this.resultFocus > -1) {
          this.resultFocus--;
          this.render();
          if (this.resultFocus === -1) this.input.focus();
        }
        return true;
      case 'CANCEL': // the on-screen keyboard was dismissed
        this.input.blur();
        return true;
      default:
        return true;
    }
  };

  Settings.prototype.onKey = function (key) {
    if (this.mode === 'search') return this.onSearchKey(key);
    const row = this.rows[this.focus];
    switch (key) {
      // Past the first or last setting, ▲▼ move the page stack instead.
      case 'UP':
        if (this.focus === 0) return false;
        this.focus--;
        this.renderFocus();
        return true;
      case 'DOWN':
        if (this.focus === this.rows.length - 1) return false;
        this.focus++;
        this.renderFocus();
        return true;
      case 'LEFT':
        row.change(-1);
        return true;
      case 'RIGHT':
        row.change(1);
        return true;
      case 'ENTER':
        if (row.enter) row.enter();
        else row.change(1);
        return true;
      default:
        return false;
    }
  };

  // Back closes the city search, then returns to the first setting.
  Settings.prototype.onBack = function () {
    if (this.mode === 'search') {
      this.closeSearch();
      return true;
    }
    if (this.focus !== 0) {
      this.focus = 0;
      this.render();
      return true;
    }
    return false;
  };

  Settings.prototype.onShow = function () {
    this.renderAbout();
  };

  // Leaving the page (or the idle return) closes the search and its keyboard.
  Settings.prototype.onHide = function () {
    if (this.mode === 'search') this.closeSearch();
  };

  // Version and where the data came from, for checking things on the TV.
  Settings.prototype.renderAbout = function () {
    const list = this.aboutEl;
    list.innerHTML = '';
    const row = (label, value) => {
      make('dt', null, list, label);
      make('dd', null, list, value);
    };
    const shortName = (url) => (url.indexOf('api.open-meteo.com') > -1 ? 'Weather' : url.split('?')[0].split('/').pop() || url);
    const describe = (entry) => {
      const when = entry.at ? new Date(entry.at).toLocaleString() : 'never';
      if (entry.source === 'network') return 'live, fetched ' + when;
      if (entry.source === 'cache') return 'offline copy from ' + when + ' (' + entry.error + ')';
      return 'unavailable (' + entry.error + ')';
    };
    const sources = { manual: 'chosen above', auto: 'detected automatically', config: 'config.json default' };
    const loc = GTV.location.current();
    row('Version', GTV.VERSION + ' (' + this.ctx.platform.name + ')');
    row('Location', loc ? GTV.location.describe(loc) + ' (' + sources[loc.source] + ')' : 'not resolved yet');
    row('Resolution', window.innerWidth + '×' + window.innerHeight + ' at ' + window.devicePixelRatio + 'x');
    row('Config', this.ctx.data.configUrl);
    Object.keys(this.ctx.data.log).forEach((url) => row(shortName(url), describe(this.ctx.data.log[url])));
  };

  Settings.prototype.unmount = function () {
    this.dead = true;
    this.input.blur();
    clearInterval(this.timer);
    this.unsubscribe.forEach((off) => off());
  };

  GTV.register({
    id: 'settings',
    title: 'Settings',
    description: 'Location, time zone and units',
    mount: (el, ctx) => new Settings(el, ctx),
  });
})();
