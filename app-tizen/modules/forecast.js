// Weather page: a week of daily weather at a time, starting with today.
// ◀ ▶ page a week earlier or later, from 4 weeks back to the end of the
// 16-day forecast. Past days show the rain that fell; future days show the
// chance of rain. Data comes from the shared GTV.weather service.
(function () {
  'use strict';

  const GTV = window.GTV;
  const DAYS_PER_PAGE = 7;

  function make(tag, className, parent, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text != null) el.textContent = text;
    if (parent) parent.appendChild(el);
    return el;
  }

  // Formats a timestamp in the forecast's own time zone, so "today" and the
  // day names match the place, not wherever the TV's clock is set.
  function formatter(zone, options) {
    try {
      return new Intl.DateTimeFormat('en-GB', Object.assign({ timeZone: zone || undefined }, options));
    } catch (err) {
      return new Intl.DateTimeFormat('en-GB', options);
    }
  }

  function pageLabel(page) {
    if (page === 0) return 'Next 7 days';
    if (page === -1) return 'Last week';
    if (page === 1) return 'The week after';
    return page < 0 ? -page + ' weeks ago' : 'In ' + page + ' weeks';
  }

  function Forecast(root, ctx) {
    this.ctx = ctx;
    this.page = 0;
    this.data = null;

    root.classList.add('forecast');
    const header = make('div', 'forecast-header', root);
    const titles = make('div', null, header);
    make('h1', null, titles, 'Weather');
    this.placeEl = make('div', 'forecast-place', titles);
    this.nowEl = make('div', 'forecast-now', header);

    const range = make('div', 'forecast-range', root);
    this.prevEl = make('span', 'forecast-arrow', range, '◀');
    this.pageEl = make('span', 'forecast-page', range);
    this.datesEl = make('span', 'forecast-dates', range);
    this.nextEl = make('span', 'forecast-arrow', range, '▶');

    this.daysEl = make('div', 'forecast-days', root);
    this.statusEl = make('p', 'forecast-status', root, 'Loading the forecast…');
    make('p', 'hint', root, '◀ ▶ earlier or later weeks · Back return');

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
    this.placeEl.textContent = loc ? GTV.location.describe(loc) : '';
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

  Forecast.prototype.pageBounds = function () {
    const today = this.todayIndex();
    const count = this.data.daily.length;
    return {
      min: -Math.floor(today / DAYS_PER_PAGE),
      max: Math.ceil((count - today) / DAYS_PER_PAGE) - 1,
    };
  };

  Forecast.prototype.render = function () {
    this.daysEl.innerHTML = '';
    if (!this.data) {
      this.nowEl.innerHTML = '';
      this.statusEl.textContent = "Weather isn't available right now. Check the TV's internet connection.";
      return;
    }
    this.statusEl.textContent = '';

    const now = this.data.current;
    this.nowEl.innerHTML =
      GTV.weather.icon(now.code, now.isDay) +
      '<span class="forecast-now-temp">' + GTV.weather.formatTemp(now.temperature) + '</span>' +
      '<span class="forecast-now-label"></span>';
    this.nowEl.lastChild.textContent = GTV.weather.label(now.code);

    const bounds = this.pageBounds();
    this.page = Math.max(bounds.min, Math.min(bounds.max, this.page));
    this.prevEl.classList.toggle('is-disabled', this.page <= bounds.min);
    this.nextEl.classList.toggle('is-disabled', this.page >= bounds.max);
    this.pageEl.textContent = pageLabel(this.page);

    const zone = this.data.timezone;
    const weekday = formatter(zone, { weekday: 'short' });
    const date = formatter(zone, { day: 'numeric', month: 'short' });
    const imperial = GTV.weather.units() === 'fahrenheit';
    const today = this.todayIndex();
    const start = today + this.page * DAYS_PER_PAGE;
    const shown = [];

    for (let i = start; i < start + DAYS_PER_PAGE; i++) {
      const day = this.data.daily[i];
      const card = make('div', 'forecast-day', this.daysEl);
      if (!day) {
        card.classList.add('is-empty');
        make('div', 'forecast-empty', card, i < 0 ? '' : 'Beyond the 16-day forecast');
        continue;
      }
      shown.push(day);
      const offset = i - today;
      card.classList.toggle('is-today', offset === 0);
      card.classList.toggle('is-past', offset < 0);
      const name = offset === 0 ? 'Today' : offset === 1 ? 'Tomorrow' : offset === -1 ? 'Yesterday' : weekday.format(new Date(day.time));
      make('div', 'forecast-day-name', card, name);
      make('div', 'forecast-day-date', card, date.format(new Date(day.time)));
      const icon = make('div', 'forecast-day-icon', card);
      icon.innerHTML = GTV.weather.icon(day.code, true);
      make('div', 'forecast-day-label', card, GTV.weather.label(day.code));
      const temps = make('div', 'forecast-day-temps', card);
      make('span', 'forecast-max', temps, GTV.weather.formatTemp(day.max));
      make('span', 'forecast-min', temps, GTV.weather.formatTemp(day.min));
      const rain =
        offset < 0
          ? day.rain != null && day.rain > 0
            ? 'Rain ' + (imperial ? day.rain.toFixed(2) + ' in' : day.rain.toFixed(1) + ' mm')
            : 'No rain'
          : day.rainChance != null
          ? 'Rain ' + day.rainChance + '%'
          : '';
      make('div', 'forecast-day-detail', card, rain);
      if (day.wind != null) {
        make('div', 'forecast-day-detail', card, 'Wind ' + Math.round(day.wind) + (imperial ? ' mph' : ' km/h'));
      }
    }

    this.datesEl.textContent = shown.length
      ? date.format(new Date(shown[0].time)) +
        (shown.length > 1 ? ' – ' + date.format(new Date(shown[shown.length - 1].time)) : '')
      : '';
  };

  Forecast.prototype.onKey = function (key) {
    if (!this.data) return false;
    const bounds = this.pageBounds();
    if (key === 'LEFT' || key === 'REWIND') {
      if (this.page > bounds.min) {
        this.page--;
        this.render();
      }
      return true;
    }
    if (key === 'RIGHT' || key === 'FAST_FORWARD') {
      if (this.page < bounds.max) {
        this.page++;
        this.render();
      }
      return true;
    }
    return false;
  };

  Forecast.prototype.unmount = function () {
    this.unsubscribe.forEach((off) => off());
  };

  GTV.register({
    id: 'weather',
    title: 'Weather',
    description: 'Daily forecast',
    mount: (el, ctx) => new Forecast(el, ctx),
  });
})();
