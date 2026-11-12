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
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'docs', 'v1', 'images.json');
const CONCURRENCY = 8;
const RATE_LIMIT_RETRIES = 3;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Google rate-limits (429) after many requests from one address. A
// rate-limited photo isn't dead, so it is retried and, failing that, kept.
async function isImage(url) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url);
      await res.arrayBuffer();
      if (res.status === 429) {
        if (attempt < RATE_LIMIT_RETRIES) {
          await sleep(5000 * (attempt + 1));
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

  const images = upstream
    .filter((_, i) => alive[i])
    .map(({ url, author }) => ({ url, author: author || null, source: 'archive' }));

  // Photos added by harvest-chromecast.mjs are kept as they are; that script
  // checks and refreshes them itself.
  let harvested = [];
  if (fs.existsSync(OUT)) {
    harvested = JSON.parse(fs.readFileSync(OUT, 'utf8')).images.filter((img) => img.source === 'chromecast');
  }

  const doc = {
    sources: { archive: SOURCE, chromecast: 'https://clients3.google.com/cast/chromecast/home' },
    generated: new Date().toISOString(),
    images: images.concat(harvested),
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(doc, null, 1) + '\n');
  console.log(`${images.length} of ${upstream.length} archive images alive, plus ${harvested.length} from the Chromecast feed -> ${path.relative(ROOT, OUT)}`);
  if (rateLimited) {
    console.log(`${rateLimited} were rate-limited and kept unchecked; re-run later to verify them.`);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
