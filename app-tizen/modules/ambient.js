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
// Photos play as a loop: all of them shuffled once, then walked in order.
// The loop and position are saved on the TV, so it carries on across
// sessions and every photo shows once before any repeats.
// Left on the first photo wraps to the last; finishing the loop going
// forward reshuffles for the next one.
//
// Remote: Right/Left next/previous, OK or Play/Pause pauses, Info hides the
// clock and weather. Up/Down belong to the page stack. While another page is
// showing, photos stop changing; a fresh interval starts on return.
(function () {
  'use strict';

  const GTV = window.GTV;
  // Smaller than this is a host's "image unavailable" placeholder, not a photo.
  const MIN_PHOTO_WIDTH = 640;
  const MAX_CONSECUTIVE_FAILS = 10;
  const RETRY_MS = 60 * 1000;
  // Where the loop (its order and position) is saved, so the next session
  // carries on instead of reshuffling: every photo shows once before repeats.
  const LOOP_KEY = 'gtv:loop';

  // A short, stable id for a photo URL, to save the loop compactly.
  function urlId(url) {
    let h = 5381;
    for (let i = 0; i < url.length; i++) h = ((h << 5) + h + url.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }

  function shuffled(count, avoidFirst) {
    const order = [];
    for (let i = 0; i < count; i++) order.push(i);
    for (let i = count - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = order[i];
      order[i] = order[j];
      order[j] = tmp;
    }
    // Don't repeat the last photo of the previous loop.
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
    this.listKey = ''; // the loaded list's URLs, to tell a changed list apart
    this.order = []; // the loop: indexes into images, shuffled
    this.pos = -1; // where in the loop the current photo is
    this.wrappedBack = false; // went left past the first photo
    this.broken = new Set();
    this.fails = 0;
    this.paused = false; // paused with the remote
    this.hidden = false; // another page is showing
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
        const key = list.map((item) => item.url).join('\n');
        this.images = list;
        // The periodic re-read usually returns the same list: keep the loop
        // as it is. On the first load, or when the list changed, carry on
        // with the saved loop; the photo on screen stays until its timer ends.
        if (key !== this.listKey) {
          this.listKey = key;
          this.ids = list.map((item) => urlId(item.url));
          this.restoreLoop();
          this.wrappedBack = false;
          this.broken.clear();
        }
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

  // Rebuilds the loop from the saved one: same order, same position. Photos
  // no longer in the list drop out; photos new to the list are slotted in at
  // random among the ones not shown yet. With nothing saved, a fresh shuffle.
  Ambient.prototype.restoreLoop = function () {
    let saved = null;
    try {
      saved = JSON.parse(localStorage.getItem(LOOP_KEY));
    } catch (err) {
      saved = null;
    }
    const n = this.images.length;
    if (!saved || !saved.order || !saved.order.length) {
      this.order = shuffled(n, -1);
      this.pos = -1;
      return;
    }
    const indexById = {};
    this.ids.forEach((id, i) => {
      indexById[id] = i;
    });
    const order = [];
    const used = {};
    let pos = -1;
    saved.order.forEach((id, k) => {
      const i = indexById[id];
      if (i === undefined || used[i]) return;
      used[i] = true;
      order.push(i);
      if (k <= saved.pos) pos = order.length - 1;
    });
    for (let i = 0; i < n; i++) {
      if (used[i]) continue;
      const at = pos + 1 + Math.floor(Math.random() * (order.length - pos));
      order.splice(at, 0, i);
    }
    this.order = order;
    this.pos = pos;
  };

  Ambient.prototype.saveLoop = function () {
    try {
      localStorage.setItem(LOOP_KEY, JSON.stringify({ pos: this.pos, order: this.order.map((i) => this.ids[i]) }));
    } catch (err) {
      // Not saved; the next session reshuffles. Not worth interrupting for.
    }
  };

  // Move through the loop by `dir` (+1 or -1), skipping known-broken photos.
  // `instant` (◀ ▶ on the remote) swaps without the crossfade; the automatic
  // change fades.
  Ambient.prototype.step = function (dir, instant) {
    const n = this.order.length;
    if (!n) return;
    if (this.broken.size >= n) this.broken.clear();
    for (let tries = 0; tries < n; tries++) {
      this.pos += dir;
      if (this.pos >= n) {
        // Past the end going forward. If we got here by wrapping left, this
        // is just the way back to the start; otherwise the loop is done.
        if (this.wrappedBack) this.wrappedBack = false;
        else this.order = shuffled(n, this.order[n - 1]);
        this.pos = 0;
      } else if (this.pos < 0) {
        this.pos = n - 1;
        this.wrappedBack = true;
      }
      if (!this.broken.has(this.order[this.pos])) break;
    }
    this.saveLoop();
    this.display(this.order[this.pos], instant, dir);
  };

  Ambient.prototype.next = function (instant) {
    this.step(1, instant);
  };

  Ambient.prototype.previous = function (instant) {
    this.step(-1, instant);
  };

  // The photo after the current one, to load ahead; null when finishing the
  // loop will reshuffle and the next photo isn't known yet.
  Ambient.prototype.upcoming = function () {
    if (this.pos + 1 < this.order.length) return this.order[this.pos + 1];
    return this.wrappedBack ? this.order[0] : null;
  };

  // Load the photo off-screen first so the crossfade never shows a half-drawn
  // image. The pending automatic change is cancelled now and a full interval
  // starts once the photo is up, so a remote press never gets cut short.
  Ambient.prototype.display = function (index, instant, dir) {
    const token = ++this.token;
    const item = this.images[index];
    clearTimeout(this.timer);
    const img = new Image();
    const skip = () => {
      if (this.dead || token !== this.token) return;
      this.broken.add(index);
      this.fails++;
      if (this.fails >= MAX_CONSECUTIVE_FAILS) {
        this.fails = 0;
        this.setStatus("Can't load photos. Retrying in a minute…");
        this.timer = setTimeout(() => this.next(), RETRY_MS);
        return;
      }
      this.step(dir || 1, instant); // keep going the way the viewer was going
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
    if (!this.paused && !this.hidden) this.timer = setTimeout(() => this.next(), this.intervalMs);
  };

  Ambient.prototype.onShow = function () {
    this.hidden = false;
    this.schedule();
  };

  Ambient.prototype.onHide = function () {
    this.hidden = true;
    clearTimeout(this.timer);
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
