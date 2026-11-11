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
const CONCURRENCY = 16;

async function isImage(url) {
  try {
    const res = await fetch(url);
    await res.arrayBuffer();
    const type = res.headers.get('content-type') || '';
    return res.ok && type.startsWith('image/');
  } catch {
    return false;
  }
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

  const images = upstream
    .filter((_, i) => alive[i])
    .map(({ url, author }) => ({ url, author: author || null }));

  const doc = {
    source: SOURCE,
    generated: new Date().toISOString(),
    images,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(doc, null, 1) + '\n');
  console.log(`${images.length} of ${upstream.length} images alive -> ${path.relative(ROOT, OUT)}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
