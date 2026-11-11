// Downloads every photo in docs/v1/images.json to a local folder, so they
// survive the upstream Google URLs dying.
//
//   node scripts/backup-images.mjs [--out <dir>]     (default: ./backup)
//
// Safe to re-run: files already on disk are skipped. File names are derived
// from the URL, so they stay stable when images.json is rebuilt. The folder
// gets an index.json mapping each file back to its URL and photographer.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LIST = path.join(ROOT, 'docs', 'v1', 'images.json');
const CONCURRENCY = 8;

const outArg = process.argv.indexOf('--out');
const OUT = path.resolve(outArg > -1 ? process.argv[outArg + 1] : path.join(ROOT, 'backup'));

function fileNameFor(url) {
  const hash = crypto.createHash('sha1').update(url).digest('hex').slice(0, 8);
  let base = decodeURIComponent(decodeURIComponent(new URL(url).pathname.split('/').pop() || 'image'));
  base = base.replace(/[^\w.+-]+/g, '_').slice(-80);
  if (!/\.(jpe?g|png|webp|gif)$/i.test(base)) base += '.jpg';
  return `${hash}-${base}`;
}

async function main() {
  const { images } = JSON.parse(fs.readFileSync(LIST, 'utf8'));
  fs.mkdirSync(OUT, { recursive: true });

  const indexPath = path.join(OUT, 'index.json');
  const index = fs.existsSync(indexPath) ? JSON.parse(fs.readFileSync(indexPath, 'utf8')) : {};

  let next = 0, downloaded = 0, skipped = 0, bytes = 0;
  const failed = [];

  async function worker() {
    while (next < images.length) {
      const { url, author } = images[next++];
      const file = fileNameFor(url);
      const target = path.join(OUT, file);
      index[file] = { url, author };
      if (fs.existsSync(target) && fs.statSync(target).size > 0) {
        skipped++;
        continue;
      }
      try {
        const res = await fetch(url);
        const type = res.headers.get('content-type') || '';
        if (!res.ok || !type.startsWith('image/')) throw new Error(`HTTP ${res.status} ${type}`);
        const buf = Buffer.from(await res.arrayBuffer());
        fs.writeFileSync(target, buf);
        downloaded++;
        bytes += buf.length;
      } catch (err) {
        failed.push(`${url}  (${err.message})`);
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  fs.writeFileSync(indexPath, JSON.stringify(index, null, 1) + '\n');
  console.log(`${downloaded} downloaded (${(bytes / 1e6).toFixed(1)} MB), ${skipped} already present, ${failed.length} failed -> ${OUT}`);
  if (failed.length) console.log('Failed:\n  ' + failed.join('\n  '));
}

main().catch((err) => { console.error(err); process.exit(1); });
