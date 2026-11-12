// Link checks in the scripts. Google answers 429 (rate-limited) after many
// requests from one address; a rate-limited photo isn't dead and must not be
// dropped from the list.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isImage } from '../scripts/build-images.mjs';
import { stillWorks } from '../scripts/harvest-chromecast.mjs';

// A fresh Response each time: a body can only be read once.
const response = (status, type) => () =>
  new Response(status === 200 ? 'x' : '', { status, headers: type ? { 'content-type': type } : {} });

// Replaces fetch with one answering from `answers` in turn; returns the URLs asked.
const realFetch = globalThis.fetch;
function fakeFetch(t, ...answers) {
  const asked = [];
  globalThis.fetch = async (url) => {
    asked.push(url);
    const a = answers[Math.min(asked.length, answers.length) - 1];
    if (a instanceof Error) throw a;
    return a();
  };
  t.after(() => (globalThis.fetch = realFetch));
  return asked;
}

const noWait = () => Promise.resolve();

test('archive check: a photo that loads is kept, a dead or non-image link is not', async (t) => {
  fakeFetch(t, response(200, 'image/jpeg'));
  assert.equal(await isImage('https://x.test/a', noWait), true);
  fakeFetch(t, response(404));
  assert.equal(await isImage('https://x.test/a', noWait), false);
  fakeFetch(t, response(200, 'text/html'));
  assert.equal(await isImage('https://x.test/a', noWait), false, 'an error page served with 200');
  fakeFetch(t, new Error('ECONNRESET'));
  assert.equal(await isImage('https://x.test/a', noWait), false);
});

test('archive check: a rate-limited photo is retried after a growing pause', async (t) => {
  const asked = fakeFetch(t, response(429), response(429), response(200, 'image/jpeg'));
  const waits = [];
  assert.equal(await isImage('https://x.test/a', async (ms) => waits.push(ms)), true);
  assert.equal(asked.length, 3);
  assert.deepEqual(waits, [5000, 10000]);
});

test('archive check: a photo still rate-limited after the retries is kept', async (t) => {
  const asked = fakeFetch(t, response(429));
  assert.equal(await isImage('https://x.test/a', noWait), true);
  assert.equal(asked.length, 4, 'one try and three retries');
});

test('archive check: a dead link found on a retry is dropped', async (t) => {
  fakeFetch(t, response(429), response(404));
  assert.equal(await isImage('https://x.test/a', noWait), false);
});

test('feed check: a rate-limited photo is kept, a dead one dropped', async (t) => {
  const asked = fakeFetch(t, response(429));
  assert.equal(await stillWorks('https://x.test/p'), true);
  assert.deepEqual(asked, ['https://x.test/p=s64'], 'checks a small thumbnail');
  fakeFetch(t, response(200, 'image/jpeg'));
  assert.equal(await stillWorks('https://x.test/p'), true);
  fakeFetch(t, response(404));
  assert.equal(await stillWorks('https://x.test/p'), false);
  fakeFetch(t, response(200, 'text/html'));
  assert.equal(await stillWorks('https://x.test/p'), false);
  fakeFetch(t, new Error('offline'));
  assert.equal(await stillWorks('https://x.test/p'), false);
});
