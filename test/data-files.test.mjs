// The published data: docs/v1/ goes straight to the TV when pushed, written
// by scripts and by hand, so check it before it ships.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));
const images = read('docs/v1/images.json');
const config = read('docs/v1/config.json');
const excluded = read('scripts/excluded-photos.json');

test('images.json has photos, each with a link', () => {
  assert.ok(Array.isArray(images.images) && images.images.length > 100, 'expected a few hundred photos');
  images.images.forEach((img, i) => {
    assert.equal(typeof img.url, 'string', 'photo ' + i + ' has no url');
    assert.match(img.url, /^https:\/\//, 'photo ' + i + ' is not an https link: ' + img.url);
  });
});

test('no photo is listed twice', () => {
  const seen = new Map();
  images.images.forEach((img, i) => {
    assert.ok(!seen.has(img.url), 'photo ' + i + ' repeats photo ' + seen.get(img.url) + ': ' + img.url);
    seen.set(img.url, i);
  });
});

test('every photo has a known source tag and a valid added date', () => {
  const tags = Object.keys(images.sources || {});
  assert.ok(tags.length > 0, 'images.json lists its sources');
  tags.forEach((tag) => assert.match(images.sources[tag], /^https?:\/\//, 'source ' + tag + ' has a URL'));
  images.images.forEach((img, i) => {
    assert.ok(tags.includes(img.source), 'photo ' + i + ' has an unknown source: ' + img.source);
    assert.ok(!isNaN(Date.parse(img.added)), 'photo ' + i + ' has no valid added date: ' + img.added);
    assert.ok(Date.parse(img.added) <= Date.now(), 'photo ' + i + ' was added in the future');
  });
});

test('no photo removed on purpose is back in the list', () => {
  const listed = new Set(images.images.map((img) => img.url));
  excluded.forEach((e) => assert.ok(!listed.has(e.url), 'excluded photo is listed again: ' + e.url));
});

test('every exclusion says why and when', () => {
  excluded.forEach((e) => {
    assert.ok(e.url && e.source && e.reason, 'exclusion is missing url, source or reason: ' + JSON.stringify(e));
    assert.ok(!isNaN(Date.parse(e.excluded)), 'exclusion has no valid date: ' + e.url);
  });
});

test('config.json has what the app reads', () => {
  assert.equal(typeof config.startModule, 'string');
  const ambient = config.modules && config.modules.ambient;
  assert.ok(ambient, 'modules.ambient');
  assert.equal(ambient.images, 'images.json', 'the slideshow reads images.json next to the config');
  assert.ok(ambient.intervalSeconds >= 5, 'a sensible photo interval');
  const w = config.weather;
  assert.ok(w && isFinite(w.latitude) && isFinite(w.longitude), 'a fallback weather location');
  // config.json is public: keep the fallback location to city precision.
  [w.latitude, w.longitude].forEach((v) => assert.ok(Math.round(v * 100) / 100 === v, 'coordinate has more than 2 decimals: ' + v));
});
