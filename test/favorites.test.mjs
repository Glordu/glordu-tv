// Favorites in the slideshow order: extra turns between the loop's photos,
// 1% of turns per favorite up to a quarter, taking turns among themselves,
// without changing the loop (every photo still shows once per pass).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp, plain, settle } from './helpers/app.mjs';

const url = (i) => 'https://example.test/photo-' + i;
const photos = (n) => Array.from({ length: n }, (_, i) => ({ url: url(i) }));
const name = (u) => u.split('-').pop();

// A slideshow on `images` with `favorites` (photo numbers) saved on the TV;
// `win` carries storage between sessions. Records what shows and whether it
// was a favorite's extra turn.
async function session(images, favorites, win) {
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
  if (favorites) win.storage.set('gtv:favorites', JSON.stringify(favorites.map(url)));
  const ctx = {
    config: { showWeather: false, clock: false },
    data: { resolve: (p) => p, fetchJson: () => Promise.resolve({ images: images }) },
    platform: { keepScreenOn() {} },
  };
  const s = win.GTV.defs.ambient.mount(win.document.createElement('div'), ctx);
  const shown = [];
  s.display = function (index) {
    this.currentUrl = this.images[index].url;
    shown.push({ n: name(this.currentUrl), extra: this.extra != null });
  };
  await settle(); // the list loads and the first photo shows
  return { win, s, shown };
}

const range = (n) => Array.from({ length: n }, (_, i) => i);
const count = (list) => list.reduce((acc, x) => ((acc[x] = (acc[x] || 0) + 1), acc), {});

test('with no favorites, nothing changes', async () => {
  const { s, shown } = await session(photos(50));
  for (let i = 0; i < 100; i++) s.next();
  assert.ok(shown.every((x) => !x.extra));
});

test('each favorite gets about 1% of the turns, and they take turns evenly', async () => {
  const { s, shown } = await session(photos(200), [3, 50, 77, 120, 199]);
  for (let i = 0; i < 1000; i++) s.next();
  const extras = shown.filter((x) => x.extra);
  assert.ok(extras.length >= 49 && extras.length <= 51, '5% of 1000 turns, got ' + extras.length);
  const per = Object.values(count(extras.map((x) => x.n)));
  assert.equal(per.length, 5, 'every favorite had turns');
  assert.ok(Math.max(...per) - Math.min(...per) <= 1, 'evenly: ' + per.join(', '));
});

test('favorites never take more than a quarter of the turns', async () => {
  const { s, shown } = await session(photos(200), range(60));
  for (let i = 0; i < 1000; i++) s.next();
  const extras = shown.filter((x) => x.extra).length;
  assert.ok(extras >= 249 && extras <= 251, '25% of 1000 turns, got ' + extras);
});

test('the loop is unchanged: every photo still shows once per pass', async () => {
  const { s, shown } = await session(photos(100), range(20));
  while (shown.filter((x) => !x.extra).length < 100) s.next();
  const loop = shown.filter((x) => !x.extra).map((x) => x.n);
  assert.equal(new Set(loop).size, 100);
});

test('Left from a favorite\'s turn goes back to the photo before it', async () => {
  const { s, shown } = await session(photos(100), range(25));
  while (!shown[shown.length - 1].extra) s.next();
  const before = shown[shown.length - 2];
  s.previous();
  assert.equal(shown[shown.length - 1].n, before.n);
  s.credit = 0; // so Right is the loop's turn
  s.next();
  assert.equal(shown[shown.length - 1].n, String(s.order[s.pos]), 'Right carries on with the loop');
  assert.notEqual(shown[shown.length - 1].n, before.n);
});

test('a favorite is not given a turn while it is already on screen', async () => {
  const { s, shown } = await session(photos(10), [4]);
  // Put the only favorite on screen and earn a full turn.
  s.currentUrl = url(4);
  s.credit = 0.99;
  s.next();
  assert.ok(!shown[shown.length - 1].extra);
});

test('a favorite whose link stopped working gets no more turns', async () => {
  const { s, shown } = await session(photos(100), [4, 5]);
  s.broken.add(4); // it failed to load
  for (let i = 0; i < 500; i++) s.next();
  const extras = shown.filter((x) => x.extra).map((x) => x.n);
  assert.ok(extras.length > 0);
  assert.ok(extras.every((n) => n === '5'), 'only the working favorite: ' + extras.join(', '));
});

test('favorites gone from the photo list are ignored', async () => {
  const { s, shown } = await session(photos(50), [500, 501]);
  for (let i = 0; i < 200; i++) s.next();
  assert.ok(shown.every((x) => !x.extra));
});

test('progress toward the next favorite turn, and who had one, carry across restarts', async () => {
  const first = await session(photos(100), [1, 2, 3, 4]);
  for (let i = 0; i < 37; i++) first.s.next();
  const credit = first.s.credit;
  const had = plain(first.s.favShown);
  const second = await session(photos(100), null, first.win);
  // The new session's first photo earns its 4% too.
  let expected = credit + 0.04;
  if (expected >= 1) expected -= 1;
  assert.ok(Math.abs(second.s.credit - expected) < 1e-9, second.s.credit + ' vs ' + expected);
  assert.deepEqual(plain(second.s.favShown).slice(0, had.length), had);
});
