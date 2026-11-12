// Draws the app's background gradients as small PNGs in app-tizen/img/.
//
//   node scripts/make-backgrounds.mjs
//
// Why images and not CSS gradients: this TV rasterizes in software, and a
// full-screen CSS gradient cost ~4.9 s of raster work per page slide (traced
// on the TV). The same gradient as a small stretched image costs about as
// much as a solid color. Gradients are smooth, so stretching loses nothing.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'app-tizen', 'img');

const CRC = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function png(w, h, pixel) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = pixel(x, y);
      const o = y * (w * 4 + 1) + 1 + x * 4;
      raw[o] = p[0];
      raw[o + 1] = p[1];
      raw[o + 2] = p[2];
      raw[o + 3] = p[3];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

fs.mkdirSync(OUT, { recursive: true });

// Page background: navy in the top-left corner fading to near-black by 70%
// of the way to the far corner (was radial-gradient(ellipse at top left, ...)).
const W = 192;
const H = 108;
fs.writeFileSync(
  path.join(OUT, 'page-bg.png'),
  png(W, H, (x, y) => {
    const d = Math.hypot(x / W, y / H) / Math.SQRT2;
    return mix([0x1d, 0x2b, 0x44, 255], [0x0a, 0x0d, 0x14, 255], Math.min(1, d / 0.7));
  })
);

// Slideshow shade behind the clock: transparent at the top to 45% black at
// the bottom.
fs.writeFileSync(
  path.join(OUT, 'shade.png'),
  png(1, 64, (x, y) => [0, 0, 0, Math.round(255 * 0.45 * (y / 63))])
);

console.log('Wrote app-tizen/img/page-bg.png and app-tizen/img/shade.png');
