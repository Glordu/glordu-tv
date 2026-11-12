// Rebuilds docs/v1/images.json from the upstream Chromecast backgrounds
// archive, keeping only the URLs that still serve an image.
//
//   node scripts/build-images.mjs
//
// The upstream list is from 2019 and links straight to Google's servers, so
// entries die over time. Re-run this now and then to prune the dead ones.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const UPSTREAM = 'https://raw.githubusercontent.com/dconnolly/chromecast-backgrounds/master/backgrounds.json';
const SOURCE = 'https://github.com/dconnolly/chromecast-backgrounds';
// Each entry in images.json says where it came from (`source`, a short tag
// listed with its URL under `sources`) and when it was added (`added`).
const TAG = 'dconnolly-archive';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'docs', 'v1', 'images.json');
const CONCURRENCY = 8;
const RATE_LIMIT_RETRIES = 3;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Google rate-limits (429) after many requests from one address. A
// rate-limited photo isn't dead, so it is retried and, failing that, kept.
// `wait` is for tests, to skip the pauses.
export async function isImage(url, wait = sleep) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url);
      await res.arrayBuffer();
      if (res.status === 429) {
        if (attempt < RATE_LIMIT_RETRIES) {
          await wait(5000 * (attempt + 1));
          continue;
        }
        rateLimited++;
        return true;
      }
      const type = res.headers.get('content-type') || '';
      return res.ok && type.startsWith('image/');
    } catch {
      return false;
    }
  }
}
let rateLimited = 0;

// Builds the new list from the upstream archive (with `alive[i]` saying
// whether entry i still works) and the previous list. Photos from other
// sources (e.g. harvest-chromecast.mjs) are kept as they are; archive photos
// already listed keep the date they were first added; excluded URLs (photos
// removed on purpose) stay out.
export function mergeArchive(upstream, alive, previous, excludedUrls, now) {
  const excluded = new Set(excludedUrls);
  const others = previous.images.filter((img) => img.source !== TAG);
  const addedBefore = {};
  previous.images.forEach((img) => {
    if (img.source === TAG && img.added) addedBefore[img.url] = img.added;
  });
  const images = upstream
    .filter((item, i) => alive[i] && !excluded.has(item.url))
    .map(({ url, author }) => ({ url, author: author || null, source: TAG, added: addedBefore[url] || now }));
  const doc = {
    sources: Object.assign({}, previous.sources, { [TAG]: SOURCE }),
    generated: now,
    images: images.concat(others),
  };
  return { doc, images, others };
}

async function main() {
  const res = await fetch(UPSTREAM);
  if (!res.ok) throw new Error(`Upstream list returned ${res.status}`);
  const upstream = await res.json();

  const alive = new Array(upstream.length).fill(false);
  let next = 0, done = 0;
  async function worker() {
    while (next < upstream.length) {
      const i = next++;
      alive[i] = await isImage(upstream[i].url);
      done++;
      if (done % 50 === 0) process.stdout.write(`  checked ${done}/${upstream.length}\n`);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  const previous = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : { sources: {}, images: [] };
  const excluded = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts', 'excluded-photos.json'), 'utf8')).map((e) => e.url);
  const { doc, images, others } = mergeArchive(upstream, alive, previous, excluded, new Date().toISOString());
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(doc, null, 1) + '\n');
  console.log(`${images.length} of ${upstream.length} archive images alive, plus ${others.length} from other sources -> ${path.relative(ROOT, OUT)}`);
  if (rateLimited) {
    console.log(`${rateLimited} were rate-limited and kept unchecked; re-run later to verify them.`);
  }
}

// Runs only from the command line, not when tests import mergeArchive.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
