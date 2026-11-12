// Weather page: the selected day in detail (icon, high/low, rain, wind, sun
// times and an hourly chart) over a strip of that day's week. ◀ ▶ move a day
// at a time, from 4 weeks back to the end of the 16-day forecast; Back
// returns to today. Data comes from the shared GTV.weather service.
(function () {
  'use strict';

  const GTV = window.GTV;
  const DAYS_PER_STRIP = 7;
  const CHART_W = 1720; // SVG units; the chart box is 86rem × 13rem
  const CHART_H = 260;
  const RESET_AFTER_HIDDEN_MS = 5 * 60 * 1000;

  function make(tag, className, parent, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text != null) el.textContent = text;
    if (parent) parent.appendChild(el);
    return el;
  }

  // Formats dates in the forecast's own time zone, so "today" and the day
  // names match the place, not wherever the TV's clock is set.
  function formatter(zone, options) {
    try {
      return new Intl.DateTimeFormat('en-GB', Object.assign({ timeZone: zone || undefined }, options));
    } catch (err) {
      return new Intl.DateTimeFormat('en-GB', options);
    }
  }

  function Forecast(root, ctx) {
    this.ctx = ctx;
    this.data = null;
    this.offset = 0; // selected day, relative to today
    this.hiddenAt = 0;

    root.classList.add('forecast');
    const head = make('div', 'fc-head', root);
    const titles = make('div', null, head);
    make('h1', null, titles, 'Weather');
    this.placeEl = make('span', 'fc-place', titles);
    this.nowEl = make('div', 'fc-now', head);

    const detail = make('div', 'fc-detail', root);
    this.iconEl = make('div', 'fc-icon', detail);
    const main = make('div', 'fc-main', detail);
    this.dayEl = make('div', 'fc-day', main);
    const temps = make('div', 'fc-temps', main);
    this.maxEl = make('span', null, temps);
    this.minEl = make('span', 'fc-min', temps);
    this.labelEl = make('div', 'fc-label', main);
    this.factsEl = make('div', 'fc-facts', detail);

    this.chartEl = make('div', 'fc-chart', root);
    this.stripEl = make('div', 'fc-strip', root);
    this.statusEl = make('p', 'fc-status', root, 'Loading the forecast…');
    make('p', 'hint fc-hint', root, '◀ ▶ day · ▲▼ other pages · Back to today');

    this.unsubscribe = [
      GTV.weather.subscribe((data) => {
        this.data = data;
        this.render();
      }),
      GTV.location.onChange(() => this.renderPlace()),
    ];
    GTV.location.get().then(() => this.renderPlace());
    this.renderPlace();
  }

  Forecast.prototype.renderPlace = function () {
    const loc = GTV.location.current();
    this.placeEl.textContent = loc ? ' · ' + GTV.location.describe(loc) : '';
  };

  // Index of today in data.daily (the list starts weeks in the past).
  Forecast.prototype.todayIndex = function () {
    const day = formatter(this.data.timezone, { year: 'numeric', month: '2-digit', day: '2-digit' });
    const today = day.format(new Date());
    for (let i = 0; i < this.data.daily.length; i++) {
      if (day.format(new Date(this.data.daily[i].time)) === today) return i;
    }
    return 0;
  };

  Forecast.prototype.render = function () {
    if (!this.data) {
      this.statusEl.textContent = "Weather isn't available right now. Check the TV's internet connection.";
      return;
    }
    this.statusEl.textContent = '';
    const data = this.data;
    const zone = data.timezone;
    const today = this.todayIndex();
    this.offset = Math.max(-today, Math.min(data.daily.length - 1 - today, this.offset));
    const index = today + this.offset;
    const day = data.daily[index];
    const imperial = GTV.weather.units() === 'fahrenheit';
    const weekday = formatter(zone, { weekday: 'long' });
    const shortDay = formatter(zone, { weekday: 'short' });
    const date = formatter(zone, { day: 'numeric', month: 'short' });
    const name = (offset, d, short) =>
      offset === 0 ? 'Today' : offset === 1 ? 'Tomorrow' : offset === -1 ? 'Yesterday' : (short ? shortDay : weekday).format(new Date(d.time));

    // Now, top right
    const now = data.current;
    this.nowEl.innerHTML =
      '<span class="fc-now-label">Now</span>' +
      GTV.weather.icon(now.code, now.isDay) +
      '<span class="fc-now-temp">' + GTV.weather.formatTemp(now.temperature) + '</span>';

    // Selected day
    this.iconEl.innerHTML = GTV.weather.icon(day.code, true);
    this.dayEl.textContent = name(this.offset, day, false) + ' · ' + date.format(new Date(day.time));
    this.maxEl.textContent = GTV.weather.formatTemp(day.max);
    this.minEl.textContent = GTV.weather.formatTemp(day.min);
    this.labelEl.textContent = GTV.weather.label(day.code);

    const amount = (v) => (imperial ? v.toFixed(2) + ' in' : v.toFixed(1) + ' mm');
    let rain;
    if (this.offset < 0) rain = day.rain > 0 ? amount(day.rain) + ' fell' : 'No rain';
    else rain = (day.rainChance != null ? day.rainChance + '% chance' : '') + (day.rain > 0 ? ' · ' + amount(day.rain) : '');
    const time = (t) => (t ? GTV.clock.format(new Date(t), zone) : '–');
    this.factsEl.innerHTML = '';
    [
      ['Rain', rain],
      ['Wind', day.wind != null ? Math.round(day.wind) + (imperial ? ' mph' : ' km/h') : '–'],
      ['Sunrise', time(day.sunrise)],
      ['Sunset', time(day.sunset)],
    ].forEach((fact) => {
      const row = make('div', null, this.factsEl);
      make('span', null, row, fact[0]);
      make('b', null, row, fact[1]);
    });

    this.chartEl.innerHTML = this.chart(day, this.offset < 0, zone);

    // Strip: the 7-day week (counted from today) the selected day is in
    this.stripEl.innerHTML = '';
    const start = today + Math.floor(this.offset / DAYS_PER_STRIP) * DAYS_PER_STRIP;
    for (let i = start; i < start + DAYS_PER_STRIP; i++) {
      const d = data.daily[i];
      const cell = make('div', 'fc-cell', this.stripEl);
      if (!d) {
        cell.classList.add('is-empty');
        continue;
      }
      cell.classList.toggle('is-selected', i === index);
      cell.classList.toggle('is-past', i < today);
      make('div', 'fc-cell-name', cell, name(i - today, d, true));
      make('div', 'fc-cell-icon', cell).innerHTML = GTV.weather.icon(d.code, true);
      const t = make('div', 'fc-cell-temps', cell, GTV.weather.formatTemp(d.max));
      make('span', null, t, GTV.weather.formatTemp(d.min));
    }
  };

  // Hourly temperature as a line, with rain as bars: the chance of rain for
  // today and later, the amount that fell for past days.
  Forecast.prototype.chart = function (day, past, zone) {
    const hours = day.hours || [];
    if (hours.length < 2) return '';
    const temps = hours.map((h) => h.temperature).filter((t) => t != null);
    const lo = Math.min.apply(null, temps) - 1;
    const hi = Math.max.apply(null, temps) + 1;
    const top = 50; // room for the labels above the line
    const base = CHART_H - 40; // the hour labels sit below this
    const x = (i) => 30 + (i / (hours.length - 1)) * (CHART_W - 60);
    const y = (t) => top + (1 - (t - lo) / (hi - lo)) * (base - top - 70);
    let line = '';
    let bars = '';
    let labels = '';
    hours.forEach((h, i) => {
      if (h.temperature != null) line += (line ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(h.temperature).toFixed(1);
      const share = past ? Math.min(1, (h.rain || 0) / 4) : (h.rainChance || 0) / 100;
      if (share > 0) {
        const height = share * 60;
        bars += '<rect x="' + (x(i) - 14).toFixed(1) + '" y="' + (base - height).toFixed(1) + '" width="28" height="' + height.toFixed(1) + '" rx="4"/>';
      }
      if (i % 3 === 0 && h.temperature != null) {
        labels +=
          '<text class="fc-chart-temp" x="' + x(i).toFixed(1) + '" y="' + (y(h.temperature) - 18).toFixed(1) + '">' + GTV.weather.formatTemp(h.temperature) + '</text>' +
          '<text class="fc-chart-hour" x="' + x(i).toFixed(1) + '" y="' + (base + 34) + '">' + GTV.clock.format(new Date(h.time), zone) + '</text>';
      }
    });
    // Mark the current hour on today's chart.
    let now = '';
    const nowMs = Date.now();
    if (nowMs >= hours[0].time && nowMs < hours[hours.length - 1].time + 3600 * 1000) {
      const i = Math.min(hours.length - 1, Math.floor((nowMs - hours[0].time) / 3600000));
      if (hours[i].temperature != null) now = '<circle class="fc-chart-now" cx="' + x(i).toFixed(1) + '" cy="' + y(hours[i].temperature).toFixed(1) + '" r="9"/>';
    }
    return (
      '<svg viewBox="0 0 ' + CHART_W + ' ' + CHART_H + '" width="100%" height="100%">' +
      '<g class="fc-chart-bars">' + bars + '</g>' +
      '<path class="fc-chart-line" d="' + line + '"/>' + now + labels +
      '</svg>'
    );
  };

  Forecast.prototype.move = function (step) {
    if (!this.data) return;
    const today = this.todayIndex();
    const next = this.offset + step;
    if (today + next < 0 || today + next >= this.data.daily.length) return;
    this.offset = next;
    this.render();
  };

  Forecast.prototype.onKey = function (key) {
    if (key === 'LEFT' || key === 'REWIND') {
      this.move(-1);
      return true;
    }
    if (key === 'RIGHT' || key === 'FAST_FORWARD') {
      this.move(1);
      return true;
    }
    return false;
  };

  Forecast.prototype.onBack = function () {
    if (this.offset === 0) return false;
    this.offset = 0;
    this.render();
    return true;
  };

  // Coming back after a while starts from today again.
  Forecast.prototype.onShow = function () {
    if (this.hiddenAt && Date.now() - this.hiddenAt > RESET_AFTER_HIDDEN_MS && this.offset !== 0) {
      this.offset = 0;
      this.render();
    }
  };

  Forecast.prototype.onHide = function () {
    this.hiddenAt = Date.now();
  };

  Forecast.prototype.unmount = function () {
    this.unsubscribe.forEach((off) => off());
  };

  GTV.register({
    id: 'weather',
    title: 'Weather',
    mount: (el, ctx) => new Forecast(el, ctx),
  });
})();
