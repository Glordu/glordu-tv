// The slideshow's photo loop: shuffled once, walked in both directions,
// reshuffled after a full pass, saved across sessions.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp, settle } from './helpers/app.mjs';

const photos = (from, to) => Array.from({ length: to - from }, (_, i) => ({ url: 'https://example.test/photo-' + (from + i) }));
const name = (url) => url.split('-').pop();

// Starts a slideshow session on `images`; `win` carries storage between sessions.
async function session(images, win) {
  win = win || loadApp(['modules/ambient.js'], {
    GTV: {
      register(def) {
        this.defs = this.defs || {};
        this.defs[def.id] = def;
      },
      weather: { subscribe: () => () => {} },
      clock: { format: () => '' },
    },
  });
  const ctx = {
    config: { showWeather: false, clock: false },
    data: { resolve: (p) => p, fetchJson: () => Promise.resolve({ images: images }) },
    platform: { keepScreenOn() {} },
  };
  const slideshow = win.GTV.defs.ambient.mount(win.document.createElement('div'), ctx);
  const shown = [];
  slideshow.display = function (index) {
    shown.push(name(this.images[index].url));
  };
  await settle(); // the list loads and the first photo shows
  return { win, slideshow, shown };
}

test('the first session shows a photo and walks the loop in order', async () => {
  const { slideshow, shown } = await session(photos(0, 5));
  slideshow.next();
  slideshow.next();
  const expected = Array.from(slideshow.order.slice(0, 3)).map((i) => String(i));
  assert.deepEqual(shown, expected);
});

test('left on the first photo wraps to the last, and right comes back', async () => {
  const { slideshow, shown } = await session(photos(0, 5));
  const first = shown[0];
  slideshow.previous();
  assert.equal(shown[1], String(slideshow.order[4]));
  slideshow.next();
  assert.equal(shown[2], first);
});

test('finishing a loop reshuffles without repeating the last photo first', async () => {
  const { slideshow, shown } = await session(photos(0, 5));
  for (let i = 0; i < 4; i++) slideshow.next();
  const last = shown[4];
  slideshow.next();
  assert.equal(slideshow.pos, 0);
  assert.notEqual(shown[5], last);
  assert.equal(new Set(shown.slice(0, 5)).size, 5);
});

test('broken photos are skipped in both directions', async () => {
  const { slideshow, shown } = await session(photos(0, 5));
  slideshow.order = [0, 1, 2, 3, 4];
  slideshow.pos = 0;
  slideshow.broken = new Set([1, 2]);
  slideshow.next();
  assert.equal(shown.pop(), '3');
  slideshow.pos = 0;
  slideshow.broken = new Set([4]);
  slideshow.previous();
  assert.equal(shown.pop(), '3');
});

test('a restart carries on where the last session left off', async () => {
  const list = photos(0, 20);
  const first = await session(list);
  for (let i = 0; i < 5; i++) first.slideshow.next();
  const planned = Array.from(first.slideshow.order.slice(first.slideshow.pos + 1, first.slideshow.pos + 4)).map(String);

  const second = await session(list, first.win);
  second.slideshow.next();
  second.slideshow.next();
  assert.deepEqual(second.shown, planned);
  assert.ok(!second.shown.some((p) => first.shown.includes(p)), 'nothing from the first session repeats');
});

test('a full pass across sessions shows every photo exactly once', async () => {
  const list = photos(0, 20);
  const first = await session(list);
  for (let i = 0; i < 5; i++) first.slideshow.next();
  const second = await session(list, first.win);
  while (second.slideshow.pos < second.slideshow.order.length - 1) second.slideshow.next();
  const all = first.shown.concat(second.shown);
  assert.equal(all.length, 20);
  assert.equal(new Set(all).size, 20);
});

test('after the list changes, the loop keeps going without repeats', async () => {
  const list = photos(0, 20);
  const first = await session(list);
  for (let i = 0; i < 6; i++) first.slideshow.next();
  const seen = first.shown.slice();
  const upcoming = Array.from(first.slideshow.order.slice(first.slideshow.pos + 1)).map((i) => list[i].url);
  const removed = upcoming.slice(0, 2);
  const changed = list.filter((p) => !removed.includes(p.url)).concat(photos(100, 103));

  const second = await session(changed, first.win);
  while (second.slideshow.pos < second.slideshow.order.length - 1) second.slideshow.next();
  const rest = second.shown;
  assert.ok(!rest.some((p) => seen.includes(p)), 'nothing already seen comes back early');
  assert.ok(!rest.some((p) => removed.map(name).includes(p)), 'removed photos never show');
  for (const added of ['100', '101', '102']) assert.ok(rest.includes(added), 'new photo ' + added + ' is fitted in');
  assert.equal(seen.length + rest.length, changed.length);
});
