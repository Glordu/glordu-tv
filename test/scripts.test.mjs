// The maintenance scripts' logic: parsing the Chromecast feed page and
// merging photo lists without losing tags, dates or exclusions.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { photosIn, addNew, baseOf } from '../scripts/harvest-chromecast.mjs';
import { mergeArchive } from '../scripts/build-images.mjs';

const BS = '\\';

// Builds a feed page the way Google does: the entries as JSON, with "=" in
// strings written as =, then that JSON escaped as a JavaScript string
// literal (\\ for backslashes, \x22 for quotes, \x5b/\x5d for brackets, \/
// for slashes) inside JSON.parse('...'). A real link looked like:
//   \x22https:\/\/ccp-lh.googleusercontent.com\/chromecast-private-photos\/AOh…\\u003dw1920-h1080-p-k-no-nd-mv\x22
function feedPage(entries) {
  const json = JSON.stringify([entries]).replace(/=/g, BS + 'u003d');
  const literal = json
    .split(BS).join(BS + BS)
    .split('"').join(BS + 'x22')
    .split('[').join(BS + 'x5b')
    .split(']').join(BS + 'x5d')
    .split('/').join(BS + '/');
  return '<html><script>var data = JSON.parse(\'' + literal + '\');</script></html>';
}

const PHOTO = 'https://ccp-lh.googleusercontent.com/chromecast-private-photos/AOhGYywR9Nvh';
const OTHER = 'https://ccp-lh.googleusercontent.com/chromecast-private-photos/AOhGYyxtCa8P';

test('the feed parser reads photo links and photographers', () => {
  const html = feedPage([
    ['https://ccp-lh.googleusercontent.com/proxy/promo=w1920-h1080-p-k-no-nd-mv', null, null, null, 20, 10],
    [PHOTO + '=w1920-h1080-p-k-no-nd-mv', 'Jason Liu', null, null, 22, 7],
    [OTHER + '=w1920-h1080-p-k-no-nd-mv', "Marc O'Brien", null, null, 27, 7],
  ]);
  assert.deepEqual(photosIn(html), [
    { base: PHOTO, author: 'Jason Liu' },
    { base: OTHER, author: "Marc O'Brien" },
  ]);
});

test('the feed parser says so when the page format changes', () => {
  assert.throws(() => photosIn('<html>no data here</html>'), /format may have changed/);
});

test('harvesting adds only photos not listed or excluded, tagged and dated', () => {
  const harvested = [{ url: PHOTO + '=w1920-h1080-c', author: 'Jason Liu', source: 'chromecast-feed', added: 'earlier' }];
  const excludedBase = 'https://ccp-lh.googleusercontent.com/chromecast-private-photos/EXCLUDED';
  const known = new Set(harvested.map((h) => baseOf(h.url)).concat([excludedBase]));
  const fresh = addNew(
    harvested,
    [
      { base: PHOTO, author: 'Jason Liu' }, // already listed
      { base: excludedBase, author: 'X' }, // removed on purpose
      { base: OTHER, author: 'Marc' },
      { base: OTHER, author: 'Marc' }, // seen twice in one load
    ],
    known,
    '2026-11-12T12:00:00.000Z'
  );
  assert.equal(fresh, 1);
  assert.deepEqual(harvested[1], { url: OTHER + '=w1920-h1080-c', author: 'Marc', source: 'chromecast-feed', added: '2026-11-12T12:00:00.000Z' });
});

test('rebuilding the archive keeps dates, other sources, and exclusions', () => {
  const previous = {
    sources: { 'chromecast-feed': 'https://feed.test' },
    images: [
      { url: 'https://a.test/1.jpg', author: 'A', source: 'dconnolly-archive', added: '2026-11-11T00:00:00.000Z' },
      { url: 'https://feed.test/x=w1920-h1080-c', author: 'F', source: 'chromecast-feed', added: '2026-11-12T00:00:00.000Z' },
    ],
  };
  const upstream = [
    { url: 'https://a.test/1.jpg', author: 'A' }, // listed before: keeps its date
    { url: 'https://a.test/2.jpg', author: 'B' }, // new: dated now
    { url: 'https://a.test/3.jpg', author: 'C' }, // dead
    { url: 'https://a.test/4.jpg' }, // excluded
  ];
  const { doc } = mergeArchive(upstream, [true, true, false, true], previous, ['https://a.test/4.jpg'], 'NOW');
  assert.deepEqual(doc.images, [
    { url: 'https://a.test/1.jpg', author: 'A', source: 'dconnolly-archive', added: '2026-11-11T00:00:00.000Z' },
    { url: 'https://a.test/2.jpg', author: 'B', source: 'dconnolly-archive', added: 'NOW' },
    { url: 'https://feed.test/x=w1920-h1080-c', author: 'F', source: 'chromecast-feed', added: '2026-11-12T00:00:00.000Z' },
  ]);
  assert.deepEqual(Object.keys(doc.sources).sort(), ['chromecast-feed', 'dconnolly-archive']);
});
