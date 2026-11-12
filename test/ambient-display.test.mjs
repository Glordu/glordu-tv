// The slideshow on screen: automatic changes, pausing while hidden, remote
// changes being instant, and photos that fail to load never showing.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp, settle } from './helpers/app.mjs';

const SECOND = 1000;
const photos = (n) => Array.from({ length: n }, (_, i) => ({ url: 'https://example.test/photo-' + i }));

// A slideshow with a fake clock; `images(url)` decides which photos load.
async function slideshow(list, images, config) {
  const win = loadApp(
    ['modules/ambient.js'],
    {
      GTV: {
        register(def) {
          this.defs = this.defs || {};
          this.defs[def.id] = def;
        },
        weather: { subscribe: () => () => {} },
        clock: { format: () => '' },
      },
    },
    { fakeTimers: true, images: images }
  );
  const ctx = {
    config: Object.assign({ showWeather: false, clock: false, intervalSeconds: 60, fadeSeconds: 2 }, config),
    data: { resolve: (p) => p, fetchJson: () => Promise.resolve({ images: list }) },
    platform: { keepScreenOn() {} },
  };
  const s = win.GTV.defs.ambient.mount(win.document.createElement('div'), ctx);
  await settle(); // the list loads
  win.tick(0); // the first photo loads and shows
  const showing = () => {
    const layer = s.layers[s.front];
    const m = /photo-(\d+)/.exec(layer.style.backgroundImage || '');
    return m ? m[1] : null;
  };
  return { win, s, showing };
}

test('photos change automatically every interval', async () => {
  const { win, showing } = await slideshow(photos(10));
  const first = showing();
  assert.ok(first);
  win.tick(59 * SECOND);
  assert.equal(showing(), first);
  win.tick(1 * SECOND);
  assert.notEqual(showing(), first);
});

test('photos stop changing while another page is showing, and restart with a full interval', async () => {
  const { win, s, showing } = await slideshow(photos(10));
  const first = showing();
  win.tick(50 * SECOND);
  s.onHide();
  win.tick(10 * 60 * SECOND);
  assert.equal(showing(), first, 'nothing changes while hidden');
  s.onShow();
  win.tick(59 * SECOND);
  assert.equal(showing(), first, 'not cut short on return');
  win.tick(1 * SECOND);
  assert.notEqual(showing(), first);
});

test('a photo that finishes loading after the page was hidden does not restart the timer', async () => {
  const { win, s, showing } = await slideshow(photos(10));
  s.onKey('RIGHT'); // starts loading the next photo
  s.onHide(); // the user slides to another page before it loads
  win.tick(0); // it loads and shows
  const shown = showing();
  win.tick(10 * 60 * SECOND);
  assert.equal(showing(), shown, 'nothing changes while hidden');
});

test('a remote press restarts the interval', async () => {
  const { win, s, showing } = await slideshow(photos(10));
  win.tick(55 * SECOND);
  s.onKey('RIGHT');
  win.tick(0);
  const picked = showing();
  win.tick(30 * SECOND);
  assert.equal(showing(), picked, 'the automatic change does not fire right after a press');
});

test('remote changes swap instantly; automatic ones fade', async () => {
  const { win, s } = await slideshow(photos(10));
  s.onKey('RIGHT');
  win.tick(0);
  assert.equal(s.layers[s.front].style.transition, 'none');
  assert.equal(s.layers[1 - s.front].style.transition, 'none');
  win.tick(60 * SECOND);
  assert.match(s.layers[s.front].style.transition, /opacity 2s/);
});

test('Play/Pause stops the automatic changes until pressed again', async () => {
  const { win, s, showing } = await slideshow(photos(10));
  const first = showing();
  s.onKey('PLAY_PAUSE');
  win.tick(5 * 60 * SECOND);
  assert.equal(showing(), first);
  s.onKey('PLAY_PAUSE');
  win.tick(60 * SECOND);
  assert.notEqual(showing(), first);
});

test('OK favorites the photo on screen with a filling heart, and again unfavorites it', async () => {
  const { win, s, showing } = await slideshow(photos(10));
  const url = 'https://example.test/photo-' + showing();
  const saved = () => JSON.parse(win.storage.get('gtv:favorites') || '[]');
  assert.equal(s.onKey('ENTER'), true);
  assert.deepEqual(saved(), [url]);
  assert.ok(s.heartEl.classList.contains('is-favorite'));
  assert.ok(s.root.classList.contains('is-hearting'), 'the status steps aside');
  win.tick(1200);
  assert.ok(!s.heartEl.classList.contains('is-favorite'), 'the heart is gone after 1.2 s');
  assert.ok(!s.root.classList.contains('is-hearting'));
  s.onKey('ENTER');
  assert.deepEqual(saved(), []);
  assert.ok(s.heartEl.classList.contains('is-unfavorite'));
  assert.equal(s.paused, false, 'OK no longer pauses');
});

test('a quick second press restarts the heart, and it still goes after 1.2 s', async () => {
  const { win, s } = await slideshow(photos(10));
  s.onKey('ENTER');
  win.tick(1000);
  s.onKey('ENTER');
  win.tick(1000);
  assert.ok(s.heartEl.classList.contains('is-unfavorite'), 'the first timer did not cut the second heart short');
  win.tick(200);
  assert.equal(s.heartEl.className, 'ambient-heart');
});

test('OK before any photo is up does nothing', async () => {
  const { s } = await slideshow(photos(3), () => null);
  s.onKey('ENTER');
  assert.equal(s.favorites.size, 0);
});

test('photos that fail, or load as a tiny placeholder, are skipped and never show', async () => {
  // Only photo 7 is a real photo: the rest fail or are 100 px placeholders.
  const images = (url) => (/photo-7$/.test(url) ? { width: 1920 } : /photo-[0-3]$/.test(url) ? null : { width: 100 });
  const { win, s, showing } = await slideshow(photos(10), images);
  assert.equal(showing(), '7');
  for (let i = 0; i < 12; i++) {
    s.onKey('RIGHT');
    win.tick(0);
    assert.equal(showing(), '7', 'only the real photo ever shows');
  }
});

test('after 10 failures in a row, the slideshow says so and retries a minute later', async () => {
  let online = false;
  const { win, s, showing } = await slideshow(photos(12), () => (online ? { width: 1920 } : null));
  assert.equal(showing(), null);
  assert.match(s.statusEl.textContent, /Can't load photos/);
  online = true; // the connection comes back
  win.tick(60 * SECOND);
  assert.ok(showing(), 'a photo shows once they load again');
  assert.equal(s.statusEl.textContent, '');
});
