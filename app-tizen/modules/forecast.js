// Weather page (design: design/hourly-scroll.html).
//
//   header  title and place · clock
//   hero    current weather (icon, temperature, description, feels like) ·
//           the selected day's title, high/low, rain, wind and sun times
//   hours   a row of 6 hours (time, temperature line, icon, chance of rain)
//   strip   the week of the selected day
//
// The page has two rows to move between: the day strip (where it starts)
// and the hours row. ◀ ▶ move a day in the strip, keeping the time of day,
// or an hour in the hours row, running on into the next or previous day.
// ▲ from the strip goes to the hours row; ▲ from the hours row and ▼ from
// the strip leave the page. Back returns to now, on the strip.
(function () {
  'use strict';

  const GTV = window.GTV;
  const DAYS_PER_STRIP = 7;
  const VISIBLE_HOURS = 6;
  const BUFFER_HOURS = 6; // columns kept in the page on each side of the window
  const COL = 286; // px per hour column at 1920 wide (the row is 1716 px)
  const ROW_H = 380;
  const LINE_TOP = 100; // the temperature line's band inside the row
  const LINE_BAND = 112;
  const RESET_AFTER_HIDDEN_MS = 5 * 60 * 1000;
  // A small open umbrella (24×24); Material's umbrella icon is a closed one.
  const UMBRELLA =
    '<svg class="fc-umbrella" viewBox="0 0 24 24" width="1em" height="1em">' +
    '<path d="M12 3a9 9 0 0 1 9 9H3a9 9 0 0 1 9-9z"/>' +
    '<path d="M12 12v6.5a1.6 1.6 0 0 1-3.2 0" fill="none" stroke-width="1.8" stroke-linecap="round"/></svg>';

  function make(tag, className, parent, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text != null) el.textContent = text;
    if (parent) parent.appendChild(el);
    return el;
  }

  // Formats dates in the forecast's own time zone, so "today" and the day
  // names match the place, not wherever the TV's clock is set. Formatters
  // are slow to create on the TV, so each one is made once and reused.
  const formatters = {};
  function formatter(zone, options) {
    const key = zone + JSON.stringify(options);
    if (!formatters[key]) {
      try {
        formatters[key] = new Intl.DateTimeFormat('en-GB', Object.assign({ timeZone: zone || undefined }, options));
      } catch (err) {
        formatters[key] = new Intl.DateTimeFormat('en-GB', options);
      }
    }
    return formatters[key];
  }

  function Forecast(root, ctx) {
    this.ctx = ctx;
    this.data = null;
    this.focus = 'days';
    this.hour = 0; // selected hour, as an index into this.hours
    this.windowStart = 0; // first visible hour
    this.rendered = null; // { from, to } hour columns currently in the page
    this.hiddenAt = 0;

    root.classList.add('forecast');
    this.root = root;
    const head = make('div', 'fc-head', root);
    const titles = make('div', null, head);
    make('h1', null, titles, 'Weather');
    this.placeEl = make('span', 'fc-place', titles);
    this.clockEl = make('div', 'fc-clock', head);

    const hero = make('div', 'fc-hero', root);
    this.nowIconEl = make('div', 'fc-now-icon', hero);
    const now = make('div', null, hero);
    this.nowTempEl = make('div', 'fc-now-temp', now);
    this.nowLabelEl = make('div', 'fc-now-label', now);
    this.nowFeelsEl = make('div', 'fc-now-feels', now);
    const info = make('div', 'fc-dayinfo', hero);
    this.dayTitleEl = make('div', 'fc-day-title', info);
    const range = make('div', 'fc-day-range', info);
    this.maxEl = make('span', null, range);
    this.minEl = make('span', 'fc-min', range);
    this.factsEl = make('div', 'fc-facts', info);

    const hoursEl = make('div', 'fc-hours', root);
    this.focusEl = make('div', 'fc-hour-focus', hoursEl);
    this.trackEl = make('div', 'fc-track', hoursEl);
    this.stripEl = make('div', 'fc-strip', root);
    this.statusEl = make('p', 'fc-status', root, 'Loading the forecast…');

    this.unsubscribe = [
      GTV.weather.subscribe((data) => this.setData(data)),
      GTV.location.onChange(() => this.renderPlace()),
    ];
    GTV.location.get().then(() => this.renderPlace());
    this.renderPlace();
    this.tickClock();
    this.clockTimer = setInterval(() => this.tickClock(), 1000);
  }

  Forecast.prototype.renderPlace = function () {
    const loc = GTV.location.current();
    this.placeEl.textContent = loc ? ' · ' + GTV.location.describe(loc) : '';
  };

  Forecast.prototype.tickClock = function () {
    const text = GTV.clock.format(new Date());
    if (this.clockEl.textContent !== text) this.clockEl.textContent = text;
  };

  // ---- Data ------------------------------------------------------------------

  // Flattens the days' hours into one list, so the hours row can run across
  // midnight, and works out where "now" and "today" are.
  Forecast.prototype.setData = function (data) {
    const selectedTime = this.data && this.hours[this.hour] ? this.hours[this.hour].time : null;
    this.data = data;
    this.charts = null;
    this.rendered = null;
    this.strip = null;
    if (!data) {
      this.statusEl.textContent = "Weather isn't available right now. Check the TV's internet connection.";
      return;
    }
    this.statusEl.textContent = '';
    this.hours = [];
    this.dayStart = [];
    data.daily.forEach((day, d) => {
      this.dayStart[d] = this.hours.length;
      (day.hours || []).forEach((h, i) => this.hours.push({ day: d, inDay: i, h: h }));
    });
    this.today = this.todayIndex();
    this.now = this.nowIndex();
    // Keep the selection across a refresh, else start at now.
    let selected = this.now;
    if (selectedTime != null) {
      for (let i = 0; i < this.hours.length; i++) if (this.hours[i].h.time === selectedTime) selected = i;
    }
    this.hour = selected;
    this.windowStart = this.hour;
    this.render();
  };

  Forecast.prototype.todayIndex = function () {
    const day = formatter(this.data.timezone, { year: 'numeric', month: '2-digit', day: '2-digit' });
    const today = day.format(new Date());
    for (let i = 0; i < this.data.daily.length; i++) {
      if (day.format(new Date(this.data.daily[i].time)) === today) return i;
    }
    return 0;
  };

  Forecast.prototype.nowIndex = function () {
    const t = Date.now();
    for (let i = this.hours.length - 1; i >= 0; i--) if (this.hours[i].h.time <= t) return i;
    return 0;
  };

  // The strip's week (counted from today) that a day falls in.
  Forecast.prototype.weekStart = function (day) {
    return this.today + Math.floor((day - this.today) / DAYS_PER_STRIP) * DAYS_PER_STRIP;
  };

  // Lowest and highest hourly temperature of a strip week; the line is
  // scaled to the week so the same temperature sits at the same height.
  Forecast.prototype.weekRange = function (start) {
    this.ranges = this.ranges && this.ranges.data === this.data ? this.ranges : { data: this.data };
    if (!this.ranges[start]) {
      let lo = Infinity;
      let hi = -Infinity;
      for (let d = start; d < start + DAYS_PER_STRIP; d++) {
        const day = this.data.daily[d];
        if (!day) continue;
        day.hours.forEach((h) => {
          if (h.temperature == null) return;
          lo = Math.min(lo, h.temperature);
          hi = Math.max(hi, h.temperature);
        });
      }
      this.ranges[start] = { lo: lo - 1, hi: hi + 1 };
    }
    return this.ranges[start];
  };

  // ---- Rendering ---------------------------------------------------------------

  Forecast.prototype.render = function () {
    if (!this.data || !this.hours.length) return;
    const data = this.data;
    const zone = data.timezone;
    const day = this.hours[this.hour].day;
    const d = data.daily[day];
    const imperial = GTV.weather.units() === 'fahrenheit';
    this.root.classList.toggle('is-focus-hours', this.focus === 'hours');
    this.root.classList.toggle('is-focus-days', this.focus === 'days');

    // Current weather
    const now = data.current;
    this.nowIconEl.innerHTML = GTV.weather.icon(now.code, now.isDay);
    this.nowTempEl.textContent = GTV.weather.formatTemp(now.temperature);
    this.nowLabelEl.textContent = GTV.weather.label(now.code);
    this.nowFeelsEl.textContent = now.feelsLike != null ? 'Feels like ' + GTV.weather.formatTemp(now.feelsLike) : '';

    // Selected day
    this.dayTitleEl.textContent = this.dayName(day, false) + ' · ' + formatter(zone, { day: 'numeric', month: 'short' }).format(new Date(d.time));
    this.maxEl.textContent = GTV.weather.formatTemp(d.max);
    this.minEl.textContent = GTV.weather.formatTemp(d.min);
    const amount = (v) => (imperial ? v.toFixed(2) + ' in' : v.toFixed(1) + ' mm');
    const time = (t) => (t ? GTV.clock.format(new Date(t), zone) : '–');
    const rain = day < this.today ? (d.rain > 0 ? amount(d.rain) + ' fell' : 'none') : d.rainChance != null ? d.rainChance + '%' : '–';
    this.factsEl.innerHTML = '';
    [
      ['Rain', rain],
      ['Wind', d.wind != null ? Math.round(d.wind) + (imperial ? ' mph' : ' km/h') : '–'],
      ['Sun', time(d.sunrise) + '–' + time(d.sunset)],
    ].forEach((fact) => {
      make('span', null, this.factsEl, fact[0]);
      make('b', null, this.factsEl, fact[1]);
    });

    this.renderHours();
    this.renderStrip(day);
  };

  Forecast.prototype.dayName = function (day, short) {
    const offset = day - this.today;
    if (offset === 0) return 'Today';
    if (offset === 1) return 'Tomorrow';
    if (offset === -1) return 'Yesterday';
    return formatter(this.data.timezone, { weekday: short ? 'short' : 'long' }).format(new Date(this.data.daily[day].time));
  };

  // The hours row: only columns near the visible window are in the page
  // (there are ~1,000 hours in the data); they're rebuilt as the window
  // moves past the buffer, and the track slides to show the window.
  Forecast.prototype.renderHours = function () {
    // Keep the selected hour inside the window, scrolling only as needed.
    if (this.hour < this.windowStart) this.windowStart = this.hour;
    if (this.hour > this.windowStart + VISIBLE_HOURS - 1) this.windowStart = this.hour - VISIBLE_HOURS + 1;
    this.windowStart = Math.max(0, Math.min(this.hours.length - VISIBLE_HOURS, this.windowStart));

    const r = this.rendered;
    if (!r || this.windowStart < r.from || this.windowStart + VISIBLE_HOURS > r.to) {
      const from = Math.max(0, this.windowStart - BUFFER_HOURS);
      const to = Math.min(this.hours.length, this.windowStart + VISIBLE_HOURS + BUFFER_HOURS);
      this.buildColumns(from, to);
    }
    this.trackEl.style.transform = 'translateX(' + -this.windowStart * COL / 20 + 'rem)';
    // The highlight is its own box over the row, not a style on a column:
    // restyling a column made the TV repaint the whole row on every press.
    this.focusEl.style.transform = 'translateX(' + (this.hour - this.windowStart) * COL / 20 + 'rem)';
  };

  Forecast.prototype.buildColumns = function (from, to) {
    const zone = this.data.timezone;
    const imperial = GTV.weather.units() === 'fahrenheit';
    const shortDay = formatter(zone, { weekday: 'short' });
    const x = (i) => (i - from) * COL + COL / 2;
    const y = (i) => {
      const entry = this.hours[i];
      const range = this.weekRange(this.weekStart(entry.day));
      return LINE_TOP + (1 - (entry.h.temperature - range.lo) / (range.hi - range.lo)) * LINE_BAND;
    };

    let line = '';
    let points = '';
    let html = '';
    for (let i = from; i < to; i++) {
      const entry = this.hours[i];
      const h = entry.h;
      const midnight = entry.inDay === 0;
      if (h.temperature != null) {
        // The line restarts where a new strip week (and so a new scale) begins.
        const restart = !line || (midnight && this.weekStart(entry.day) !== this.weekStart(entry.day - 1));
        line += (restart ? 'M' : 'L') + x(i).toFixed(1) + ' ' + y(i).toFixed(1);
        const isNow = i === this.now;
        points +=
          '<circle class="fc-point' + (isNow ? ' is-now' : '') + '" cx="' + x(i).toFixed(1) + '" cy="' + y(i).toFixed(1) + '" r="' + (isNow ? 9 : 5) + '"/>' +
          '<text class="fc-point-temp" x="' + x(i).toFixed(1) + '" y="' + (y(i) - 18).toFixed(1) + '">' + GTV.weather.formatTemp(h.temperature) + '</text>';
      }
      const label = (midnight ? shortDay.format(new Date(h.time)) + ' ' : '') + GTV.clock.format(new Date(h.time), zone);
      let rain;
      if (entry.day < this.today) rain = h.rain > 0 ? (imperial ? h.rain.toFixed(2) + '″' : h.rain.toFixed(1) + ' mm') : '0 mm';
      else rain = h.rainChance != null ? Math.round(h.rainChance) + '%' : '–';
      const dry = entry.day < this.today ? !(h.rain > 0) : !h.rainChance;
      html +=
        (midnight ? '<div class="fc-divider" style="left:' + ((i - from) * COL - 1) / 20 + 'rem"></div>' : '') +
        '<div class="fc-col" style="left:' + ((i - from) * COL) / 20 + 'rem">' +
        '<div class="fc-col-time' + (midnight ? ' is-midnight' : '') + '">' + label + '</div>' +
        '<div class="fc-col-icon">' + GTV.weather.icon(h.code, h.isDay) + '</div>' +
        '<div class="fc-col-rain' + (dry ? ' is-dry' : '') + '">' + UMBRELLA + rain + '</div></div>';
    }
    const width = (to - from) * COL;
    this.trackEl.innerHTML =
      '<svg class="fc-line" viewBox="0 0 ' + width + ' ' + ROW_H + '" width="' + width / 20 + 'rem" height="' + ROW_H / 20 + 'rem">' +
      '<path d="' + line + '"/>' + points + '</svg>' + html;
    this.trackEl.style.left = (from * COL) / 20 + 'rem';
    this.columns = Array.prototype.slice.call(this.trackEl.querySelectorAll('.fc-col'));
    this.rendered = { from: from, to: to };
  };

  // Strip: the 7-day week (counted from today) the selected day is in.
  // Within the same week only the highlight moves.
  Forecast.prototype.renderStrip = function (selected) {
    const start = this.weekStart(selected);
    if (this.strip && this.strip.data === this.data && this.strip.start === start) {
      this.strip.cells.forEach((cell, n) => cell.classList.toggle('is-selected', start + n === selected));
      return;
    }
    this.strip = { data: this.data, start: start, cells: [] };
    this.stripEl.innerHTML = '';
    for (let i = start; i < start + DAYS_PER_STRIP; i++) {
      const d = this.data.daily[i];
      const cell = make('div', 'fc-cell', this.stripEl);
      this.strip.cells.push(cell);
      if (!d) {
        cell.classList.add('is-empty');
        continue;
      }
      cell.classList.toggle('is-selected', i === selected);
      cell.classList.toggle('is-past', i < this.today);
      const offset = i - this.today;
      make('div', 'fc-cell-name', cell, offset === 0 || offset === 1 ? this.dayName(i) : this.dayName(i, true));
      make('div', 'fc-cell-icon', cell).innerHTML = GTV.weather.icon(d.code, true);
      const t = make('div', 'fc-cell-temps', cell, GTV.weather.formatTemp(d.max));
      make('span', null, t, GTV.weather.formatTemp(d.min));
    }
  };

  // ---- Keys ---------------------------------------------------------------------

  // Change day, keeping the time of day; today goes back to the current hour.
  Forecast.prototype.moveDay = function (step) {
    const entry = this.hours[this.hour];
    const target = entry.day + step;
    if (target < 0 || target >= this.data.daily.length || this.dayStart[target] == null) return;
    if (target === this.today) {
      this.hour = this.now;
    } else {
      const count = this.data.daily[target].hours.length;
      this.hour = this.dayStart[target] + Math.min(entry.inDay, count - 1);
    }
    this.render();
  };

  Forecast.prototype.moveHour = function (step) {
    const next = this.hour + step;
    if (next < 0 || next >= this.hours.length) return;
    this.hour = next;
    this.render();
  };

  Forecast.prototype.onKey = function (key) {
    if (!this.data) return false;
    const left = key === 'LEFT' || key === 'REWIND';
    const right = key === 'RIGHT' || key === 'FAST_FORWARD';
    if (this.focus === 'days') {
      if (left || right) {
        this.moveDay(right ? 1 : -1);
        return true;
      }
      if (key === 'UP') {
        this.focus = 'hours';
        this.render();
        return true;
      }
      return false; // ▼ leaves the page
    }
    if (left || right) {
      this.moveHour(right ? 1 : -1);
      return true;
    }
    if (key === 'DOWN') {
      this.focus = 'days';
      this.render();
      return true;
    }
    return false; // ▲ leaves the page
  };

  Forecast.prototype.reset = function () {
    this.focus = 'days';
    this.hour = this.now;
    this.windowStart = this.now;
    this.render();
  };

  Forecast.prototype.onBack = function () {
    if (!this.data || (this.focus === 'days' && this.hour === this.now)) return false;
    this.reset();
    return true;
  };

  // The page is entered on the day strip; after a while away, back at now.
  Forecast.prototype.onShow = function () {
    if (!this.data) return;
    this.now = this.nowIndex();
    if (this.hiddenAt && Date.now() - this.hiddenAt > RESET_AFTER_HIDDEN_MS) {
      this.reset();
    } else if (this.focus !== 'days') {
      this.focus = 'days';
      this.render();
    }
  };

  Forecast.prototype.onHide = function () {
    this.hiddenAt = Date.now();
  };

  Forecast.prototype.unmount = function () {
    clearInterval(this.clockTimer);
    this.unsubscribe.forEach((off) => off());
  };

  GTV.register({
    id: 'weather',
    title: 'Weather',
    mount: (el, ctx) => new Forecast(el, ctx),
  });
})();
