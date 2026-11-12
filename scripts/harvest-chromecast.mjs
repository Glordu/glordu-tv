// Adds the photos from Google's current Chromecast backdrop feed to
// docs/v1/images.json, alongside the 2019 archive.
//
//   node scripts/harvest-chromecast.mjs [loads]      (npm run harvest)
//
// The feed page returns ~49 random photos per load from a pool of roughly
// 400, so it's loaded repeatedly (default 40 times, stopping early once 5
// loads in a row bring nothing new). Photos already in the list are kept;
// ones whose link no longer works are dropped. Re-run it now and then to
// pick up photos Google adds.
//
// Photos are listed at 1920×1080 (=w1920-h1080-c), the most the TV's app
// layer can show; the same links serve the 4K originals with =s0.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FEED = 'https://clients3.google.com/cast/chromecast/home';
// Each entry in images.json says where it came from (`source`, a short tag
// listed with its URL under `sources`) and when it was added (`added`).
const TAG = 'chromecast-feed';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LIST = path.join(ROOT, 'docs', 'v1', 'images.json');
const SIZE = '=w1920-h1080-c';
const MAX_LOADS = Number(process.argv[2]) || 40;
const STOP_AFTER_EMPTY = 5;
const BS = String.fromCharCode(92); // a backslash

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The page embeds its photo list as JSON.parse('<escaped JSON>').
function photosIn(html) {
  const start = html.indexOf("JSON.parse('");
  if (start < 0) throw new Error('No photo list found in the feed page; its format may have changed');
  const end = html.indexOf("')", start);
  let text = html.slice(start + "JSON.parse('".length, end);
  text = text.replace(new RegExp(BS + BS + 'x([0-9a-fA-F]{2})', 'g'), (_, h) => String.fromCharCode(parseInt(h, 16)));
  // JavaScript allows escapes JSON doesn't (like \= and \'); drop their backslash.
  text = text.replace(new RegExp(BS + BS + '([^"' + BS + BS + '/bfnrtu])', 'g'), '$1');
  const entries = JSON.parse(text)[0] || [];
  // Inside the links "=" is escaped once more, as a literal =.
  const unescape = (s) => s.replace(new RegExp(BS + BS + 'u([0-9a-fA-F]{4})', 'g'), (_, h) => String.fromCharCode(parseInt(h, 16)));
  return entries
    .filter((e) => typeof e[0] === 'string' && e[0].indexOf('/chromecast-private-photos/') > -1)
    .map((e) => ({ base: unescape(e[0]).replace(/=.*$/, ''), author: typeof e[1] === 'string' ? e[1] : null }));
}

const baseOf = (url) => url.replace(/=[^/]*$/, '');

// A tiny thumbnail is enough to tell whether a link still works.
async function stillWorks(base) {
  try {
    const res = await fetch(base + '=s64');
    await res.arrayBuffer();
    if (res.status === 429) return true; // rate-limited, not dead
    return res.ok && (res.headers.get('content-type') || '').startsWith('image/');
  } catch {
    return false;
  }
}

async function main() {
  const doc = JSON.parse(fs.readFileSync(LIST, 'utf8'));
  const now = new Date().toISOString();
  // Entries from other sources are left exactly as they are.
  const others = doc.images.filter((img) => img.source !== TAG);
  let harvested = doc.images.filter((img) => img.source === TAG);

  const before = harvested.length;
  const alive = await Promise.all(harvested.map((img) => stillWorks(baseOf(img.url))));
  harvested = harvested.filter((_, i) => alive[i]);
  const dropped = before - harvested.length;

  // Photos already listed, plus ones removed on purpose (e.g. duplicates),
  // are never added again.
  const known = new Set(harvested.map((img) => baseOf(img.url)));
  JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts', 'excluded-photos.json'), 'utf8')).forEach((e) => known.add(baseOf(e.url)));
  let added = 0;
  let empty = 0;
  for (let load = 1; load <= MAX_LOADS && empty < STOP_AFTER_EMPTY; load++) {
    const res = await fetch(FEED, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) throw new Error('Feed returned HTTP ' + res.status);
    let fresh = 0;
    for (const photo of photosIn(await res.text())) {
      if (known.has(photo.base)) continue;
      known.add(photo.base);
      harvested.push({ url: photo.base + SIZE, author: photo.author, source: TAG, added: now });
      fresh++;
    }
    added += fresh;
    empty = fresh ? 0 : empty + 1;
    process.stdout.write('  load ' + load + ': ' + fresh + ' new (' + harvested.length + ' from the feed)\n');
    await sleep(1500);
  }

  const out = {
    sources: Object.assign({}, doc.sources, { [TAG]: FEED }),
    generated: now,
    images: others.concat(harvested),
  };
  fs.writeFileSync(LIST, JSON.stringify(out, null, 1) + '\n');
  console.log(
    added + ' new from the feed, ' + dropped + ' dead dropped -> ' + harvested.length + ' from the feed + ' + others.length + ' others = ' + out.images.length + ' photos'
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
