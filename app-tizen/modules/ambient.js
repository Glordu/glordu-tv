// Ambient: full-screen photo slideshow with a clock, like the Chromecast's
// backdrop. Config (modules.ambient in config.json):
//   images           path to the images list, relative to config.json
//   intervalSeconds  time each photo stays up
//   fadeSeconds      crossfade length
//   clock            "24h" or "12h" (Settings can override), or false to hide
//   showWeather      current weather above the clock (needs config.weather)
//   kenBurns         slow zoom on each photo
//   refreshMinutes   how often to re-read the images list
//
// A photo is only shown once it has fully loaded, so a dead link never
// reaches the screen: the current photo stays up and the next one is tried.
//
// Remote: Right/Left next/previous, OK or Play/Pause pauses,
// Up/Down/Info hides the clock and weather.
(function () {
  'use strict';

  const GTV = window.GTV;
  // Smaller than this is a host's "image unavailable" placeholder, not a photo.
  const MIN_PHOTO_WIDTH = 640;
  const MAX_CONSECUTIVE_FAILS = 10;
  const RETRY_MS = 60 * 1000;
  const HISTORY_LIMIT = 50;

  function shuffled(count, avoidFirst) {
    const order = [];
    for (let i = 0; i < count; i++) order.push(i);
    for (let i = count - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = order[i];
      order[i] = order[j];
      order[j] = tmp;
    }
    // Don't repeat the last photo of the previous round.
    if (count > 1 && order[0] === avoidFirst) order.push(order.shift());
    return order;
  }

  function child(parent, className) {
    const el = document.createElement('div');
    el.className = className;
    parent.appendChild(el);
    return el;
  }

  function cssUrl(url) {
    return 'url("' + url.replace(/"/g, '%22') + '")';
  }

  function Ambient(root, ctx) {
    const cfg = ctx.config;
    this.ctx = ctx;
    this.intervalMs = (cfg.intervalSeconds || 60) * 1000;
    this.fadeSeconds = cfg.fadeSeconds != null ? cfg.fadeSeconds : 2;
    this.kenBurns = !!cfg.kenBurns;
    this.showClock = cfg.clock !== false;
    this.showWeather = cfg.showWeather !== false;
    this.imagesUrl = ctx.data.resolve(cfg.images || 'images.json');
    this.refreshMs = (cfg.refreshMinutes || 360) * 60 * 1000;

    this.images = [];
    this.queue = [];
    this.history = [];
    this.historyPos = -1;
    this.broken = new Set();
    this.fails = 0;
    this.paused = false;
    this.token = 0;
    this.dead = false;
    this.timer = null;
    this.retryTimer = null;

    root.classList.add('ambient');
    this.layers = [child(root, 'ambient-layer'), child(root, 'ambient-layer')];
    this.layers.forEach((layer) => {
      layer.style.transition = 'opacity ' + this.fadeSeconds + 's ease-in-out';
    });
    this.front = 0;
    child(root, 'ambient-shade');
    this.overlay = child(root, 'ambient-overlay');
    const corner = child(this.overlay, 'ambient-corner');
    this.weatherEl = child(corner, 'ambient-weather');
    this.clockEl = child(corner, 'ambient-clock');
    this.statusEl = child(root, 'ambient-status');

    if (this.showClock) {
      this.tickClock();
      this.clockTimer = setInterval(() => this.tickClock(), 1000);
    }
    if (this.showWeather) {
      this.unsubscribeWeather = GTV.weather.subscribe((data) => this.renderWeather(data));
    }

    this.setStatus('Loading photos…');
    ctx.platform.keepScreenOn(true);
    this.load();
    this.refreshTimer = setInterval(() => this.load(), this.refreshMs);
  }

  Ambient.prototype.tickClock = function () {
    const text = GTV.clock.format(new Date());
    if (this.clockEl.textContent !== text) this.clockEl.textContent = text;
  };

  Ambient.prototype.renderWeather = function (data) {
    if (!data) {
      this.weatherEl.innerHTML = '';
      return;
    }
    const now = data.current;
    this.weatherEl.innerHTML =
      '<span class="ambient-temp">' + GTV.weather.formatTemp(now.temperature) + '</span>' +
      GTV.weather.icon(now.code, now.isDay);
    this.weatherEl.title = GTV.weather.label(now.code);
  };

  Ambient.prototype.setStatus = function (text) {
    this.statusEl.textContent = text;
    this.statusEl.classList.toggle('is-visible', !!text);
  };

  Ambient.prototype.load = function () {
    clearTimeout(this.retryTimer);
    this.ctx.data
      .fetchJson(this.imagesUrl)
      .then((doc) => {
        if (this.dead) return;
        const list = ((doc && doc.images) || []).filter((item) => item && item.url);
        if (!list.length) throw new Error('The images list is empty');
        const first = !this.images.length;
        // Start a fresh round with the new list; the current photo stays up
        // until its timer runs out.
        this.images = list;
        this.queue = [];
        this.history = [];
        this.historyPos = -1;
        this.broken.clear();
        if (first) this.next();
      })
      .catch((err) => {
        if (this.dead) return;
        console.warn('Could not load images list', err);
        if (!this.images.length) {
          this.setStatus("Can't reach the photo list. Retrying in a minute…");
          this.retryTimer = setTimeout(() => this.load(), RETRY_MS);
        }
      });
  };

  Ambient.prototype.pick = function () {
    if (this.broken.size >= this.images.length) this.broken.clear();
    for (let guard = 0; guard <= this.images.length; guard++) {
      if (!this.queue.length) {
        const last = this.history.length ? this.history[this.history.length - 1] : -1;
        this.queue = shuffled(this.images.length, last);
      }
      const index = this.queue.shift();
      if (!this.broken.has(index)) return index;
    }
    return 0;
  };

  // `instant` (◀ ▶ on the remote) swaps photos without the crossfade; the
  // automatic change fades.
  Ambient.prototype.next = function (instant) {
    if (!this.images.length) return;
    if (this.historyPos < this.history.length - 1) {
      this.historyPos++;
    } else {
      this.history.push(this.pick());
      if (this.history.length > HISTORY_LIMIT) this.history.shift();
      this.historyPos = this.history.length - 1;
    }
    this.display(this.history[this.historyPos], instant);
  };

  Ambient.prototype.previous = function (instant) {
    if (this.historyPos <= 0) {
      this.schedule(); // nothing earlier, but a key press still restarts the timer
      return;
    }
    this.historyPos--;
    this.display(this.history[this.historyPos], instant);
  };

  Ambient.prototype.upcoming = function () {
    if (this.historyPos < this.history.length - 1) return this.history[this.historyPos + 1];
    if (!this.queue.length) this.queue = shuffled(this.images.length, this.history[this.historyPos]);
    return this.queue[0];
  };

  // Load the photo off-screen first so the crossfade never shows a half-drawn
  // image. The pending automatic change is cancelled now and a full interval
  // starts once the photo is up, so a remote press never gets cut short.
  Ambient.prototype.display = function (index, instant) {
    const token = ++this.token;
    const item = this.images[index];
    clearTimeout(this.timer);
    const img = new Image();
    const skip = () => {
      if (this.dead || token !== this.token) return;
      this.broken.add(index);
      this.history.splice(this.historyPos, 1);
      this.historyPos--;
      this.fails++;
      if (this.fails >= MAX_CONSECUTIVE_FAILS) {
        this.fails = 0;
        this.setStatus("Can't load photos. Retrying in a minute…");
        this.timer = setTimeout(() => this.next(), RETRY_MS);
        return;
      }
      this.next(instant);
    };
    img.onerror = skip;
    img.onload = () => {
      if (this.dead || token !== this.token) return;
      if (img.naturalWidth < MIN_PHOTO_WIDTH) {
        skip();
        return;
      }
      this.fails = 0;
      this.swap(item, instant);
      this.setStatus(this.paused ? 'Paused' : '');
      this.schedule();
      this.prefetch();
    };
    img.src = item.url;
  };

  Ambient.prototype.swap = function (item, instant) {
    const incoming = this.layers[1 - this.front];
    const outgoing = this.layers[this.front];
    const fade = 'opacity ' + this.fadeSeconds + 's ease-in-out';
    const zoom = 'transform ' + (this.intervalMs / 1000 + this.fadeSeconds * 2) + 's linear';
    const animate = (withFade) =>
      [withFade ? fade : null, this.kenBurns ? zoom : null].filter(Boolean).join(', ') || 'none';

    // Reset the incoming layer with no transition, so it starts from scratch
    // even if a previous fade or zoom on it was still running.
    incoming.style.transition = 'none';
    incoming.style.backgroundImage = cssUrl(item.url);
    if (this.kenBurns) incoming.style.transform = 'scale(1)';
    void incoming.offsetWidth; // commit the reset before animating

    // An instant swap also cuts any fade still running on the outgoing layer.
    incoming.style.transition = animate(!instant);
    outgoing.style.transition = instant ? 'none' : animate(true);
    if (this.kenBurns) incoming.style.transform = 'scale(1.08)';
    incoming.classList.add('is-visible');
    outgoing.classList.remove('is-visible');
    this.front = 1 - this.front;
  };

  Ambient.prototype.schedule = function () {
    clearTimeout(this.timer);
    if (!this.paused) this.timer = setTimeout(() => this.next(), this.intervalMs);
  };

  Ambient.prototype.prefetch = function () {
    const index = this.upcoming();
    if (index == null || !this.images[index]) return;
    this.prefetchImg = new Image(); // keep a reference so the load isn't dropped
    this.prefetchImg.src = this.images[index].url;
  };

  Ambient.prototype.setPaused = function (paused) {
    this.paused = paused;
    this.setStatus(paused ? 'Paused' : '');
    this.schedule();
  };

  Ambient.prototype.onKey = function (key) {
    switch (key) {
      case 'RIGHT':
      case 'FAST_FORWARD':
        this.next(true);
        return true;
      case 'LEFT':
      case 'REWIND':
        this.previous(true);
        return true;
      case 'ENTER':
      case 'PLAY_PAUSE':
        this.setPaused(!this.paused);
        return true;
      case 'PLAY':
        this.setPaused(false);
        return true;
      case 'PAUSE':
        this.setPaused(true);
        return true;
      case 'UP':
      case 'DOWN':
      case 'INFO':
        this.overlay.classList.toggle('is-hidden');
        return true;
      default:
        return false;
    }
  };

  Ambient.prototype.unmount = function () {
    this.dead = true;
    clearTimeout(this.timer);
    clearTimeout(this.retryTimer);
    clearInterval(this.clockTimer);
    clearInterval(this.refreshTimer);
    if (this.unsubscribeWeather) this.unsubscribeWeather();
    this.ctx.platform.keepScreenOn(false);
  };

  GTV.register({
    id: 'ambient',
    title: 'Ambient',
    description: 'Photo slideshow',
    mount: (el, ctx) => new Ambient(el, ctx),
  });
})();
