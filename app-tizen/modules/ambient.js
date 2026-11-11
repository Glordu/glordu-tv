// Ambient: full-screen photo slideshow with a clock, like the Chromecast's
// backdrop. Config (modules.ambient in config.json):
//   images           path to the images list, relative to config.json
//   intervalSeconds  time each photo stays up
//   fadeSeconds      crossfade length
//   clock            "24h", "12h" or false
//   showCredits      show the photographer's name
//   kenBurns         slow zoom on each photo
//   refreshMinutes   how often to re-read the images list
//
// Remote: Right/Left next/previous, OK or Play/Pause pauses,
// Up/Down/Info hides the clock and credit.
(function () {
  'use strict';

  const GTV = window.GTV;
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

  function pad(n) {
    return n < 10 ? '0' + n : String(n);
  }

  function formatTime(date, mode) {
    if (mode === '12h') return (date.getHours() % 12 || 12) + ':' + pad(date.getMinutes());
    return pad(date.getHours()) + ':' + pad(date.getMinutes());
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
    this.clockMode = cfg.clock === undefined ? '24h' : cfg.clock;
    this.showCredits = cfg.showCredits !== false;
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
    this.clockEl = child(this.overlay, 'ambient-clock');
    this.creditEl = child(this.overlay, 'ambient-credit');
    this.statusEl = child(root, 'ambient-status');

    if (this.clockMode) {
      this.tickClock();
      this.clockTimer = setInterval(() => this.tickClock(), 1000);
    }

    this.setStatus('Loading photos…');
    ctx.platform.keepScreenOn(true);
    this.load();
    this.refreshTimer = setInterval(() => this.load(), this.refreshMs);
  }

  Ambient.prototype.tickClock = function () {
    const text = formatTime(new Date(), this.clockMode);
    if (this.clockEl.textContent !== text) this.clockEl.textContent = text;
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

  Ambient.prototype.next = function () {
    if (!this.images.length) return;
    if (this.historyPos < this.history.length - 1) {
      this.historyPos++;
    } else {
      this.history.push(this.pick());
      if (this.history.length > HISTORY_LIMIT) this.history.shift();
      this.historyPos = this.history.length - 1;
    }
    this.display(this.history[this.historyPos]);
  };

  Ambient.prototype.previous = function () {
    if (this.historyPos <= 0) return;
    this.historyPos--;
    this.display(this.history[this.historyPos]);
  };

  Ambient.prototype.upcoming = function () {
    if (this.historyPos < this.history.length - 1) return this.history[this.historyPos + 1];
    if (!this.queue.length) this.queue = shuffled(this.images.length, this.history[this.historyPos]);
    return this.queue[0];
  };

  // Load the photo off-screen first so the crossfade never shows a half-drawn image.
  Ambient.prototype.display = function (index) {
    const token = ++this.token;
    const item = this.images[index];
    clearTimeout(this.timer);
    const img = new Image();
    img.onload = () => {
      if (this.dead || token !== this.token) return;
      this.fails = 0;
      this.swap(item);
      this.setStatus(this.paused ? 'Paused' : '');
      this.schedule();
      this.prefetch();
    };
    img.onerror = () => {
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
      this.next();
    };
    img.src = item.url;
  };

  Ambient.prototype.swap = function (item) {
    const incoming = this.layers[1 - this.front];
    const outgoing = this.layers[this.front];
    incoming.style.backgroundImage = cssUrl(item.url);
    if (this.kenBurns) {
      const zoomSeconds = this.intervalMs / 1000 + this.fadeSeconds * 2;
      incoming.style.transition = 'none';
      incoming.style.transform = 'scale(1)';
      void incoming.offsetWidth; // commit the reset before animating
      incoming.style.transition =
        'opacity ' + this.fadeSeconds + 's ease-in-out, transform ' + zoomSeconds + 's linear';
      incoming.style.transform = 'scale(1.08)';
    }
    incoming.classList.add('is-visible');
    outgoing.classList.remove('is-visible');
    this.front = 1 - this.front;
    this.creditEl.textContent = this.showCredits && item.author ? 'Photo: ' + item.author : '';
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
        this.next();
        return true;
      case 'LEFT':
      case 'REWIND':
        this.previous();
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
    this.ctx.platform.keepScreenOn(false);
  };

  GTV.register({
    id: 'ambient',
    title: 'Ambient',
    description: 'Photo slideshow',
    mount: (el, ctx) => new Ambient(el, ctx),
  });
})();
