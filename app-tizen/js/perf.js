// Hidden performance readout, toggled with the Yellow key (Y in a browser).
// The TV's remote debugger doesn't work, so this is how we measure on it:
//   Key → frame   time from a key press to the next frame drawn after it
//   Slide         frames per second and the slowest frame during the last
//                 page slide or bounce
// It only measures while it's showing, so it costs nothing when hidden.
(function () {
  'use strict';

  const GTV = window.GTV;
  const KEY = 'gtv:perf';
  const SAMPLES = 10;

  let visible = false;
  let el = null;
  let keyStart = 0;
  const keyTimes = [];
  let slide = null; // { name, ms, frames, worst }
  let measuring = null;

  function load() {
    try {
      return localStorage.getItem(KEY) === '1';
    } catch (err) {
      return false;
    }
  }

  function save() {
    try {
      localStorage.setItem(KEY, visible ? '1' : '0');
    } catch (err) {
      // Not remembered; fine.
    }
  }

  function render() {
    if (!el) return;
    el.style.display = visible ? 'block' : 'none';
    if (!visible) return;
    const lines = [];
    if (keyTimes.length) {
      const last = keyTimes[keyTimes.length - 1];
      const avg = keyTimes.reduce((a, b) => a + b, 0) / keyTimes.length;
      const worst = Math.max.apply(null, keyTimes);
      lines.push('Key → frame  last ' + Math.round(last) + ' ms · avg ' + Math.round(avg) + ' · worst ' + Math.round(worst) + ' (' + keyTimes.length + ' keys)');
    } else {
      lines.push('Key → frame  press a key');
    }
    if (slide) {
      lines.push(
        slide.name + '  ' + Math.round((slide.frames / slide.ms) * 1000) + ' fps · slowest frame ' + Math.round(slide.worst) + ' ms · ' + Math.round(slide.ms) + ' ms total' +
          (slide.prepare != null ? ' · drawn first in ' + Math.round(slide.prepare) + ' ms' : '')
      );
    } else {
      lines.push('Slide  change page to measure');
    }
    el.textContent = lines.join('\n');
  }

  GTV.perf = {
    init: function (root) {
      el = document.createElement('div');
      el.className = 'perf';
      root.appendChild(el);
      visible = load();
      render();
    },

    toggle: function () {
      visible = !visible;
      save();
      render();
    },

    // Called as a key press is handled, then once it has been dispatched.
    keyStart: function () {
      keyStart = performance.now();
    },

    keyEnd: function () {
      if (!visible) return;
      const start = keyStart;
      // The second frame callback runs after the frame showing the change.
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          keyTimes.push(performance.now() - start);
          if (keyTimes.length > SAMPLES) keyTimes.shift();
          render();
        })
      );
    },

    // Count frames for `ms` milliseconds while a slide or bounce runs.
    // `prepare` is how long drawing the incoming page took before it moved.
    measureAnimation: function (name, ms, prepare) {
      if (!visible) return;
      if (measuring) measuring.cancelled = true;
      const run = { cancelled: false };
      measuring = run;
      const start = performance.now();
      let last = start;
      let frames = 0;
      let worst = 0;
      const tick = (now) => {
        if (run.cancelled) return;
        frames++;
        worst = Math.max(worst, now - last);
        last = now;
        if (now - start < ms) {
          requestAnimationFrame(tick);
        } else {
          slide = { name: name, ms: now - start, frames: frames, worst: worst, prepare: prepare };
          render();
        }
      };
      requestAnimationFrame(tick);
    },
  };
})();
