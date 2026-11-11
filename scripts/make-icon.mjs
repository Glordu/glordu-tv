// Draws app-tizen/icon.png (512x423, Samsung's TV launcher icon size): a
// sunset over mountains. Dependency-free PNG encoder.
//
//   node scripts/make-icon.mjs

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'app-tizen', 'icon.png');
const W = 512, H = 423, SS = 4; // SS x SS supersampling for smooth edges

const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

// Piecewise-linear ridge: y of the mountain top at x, from [x, y] points.
function ridge(points, x) {
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1], [x1, y1] = points[i];
    if (x <= x1) return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
  }
  return points[points.length - 1][1];
}
const far = [[0, 290], [90, 215], [170, 270], [260, 180], [360, 265], [440, 205], [512, 250]];
const near = [[0, 340], [120, 265], [230, 335], [330, 290], [430, 345], [512, 300]];

function colorAt(x, y) {
  const t = y / H;
  let c = t < 0.55
    ? mix([24, 34, 78], [232, 112, 84], t / 0.55)
    : mix([232, 112, 84], [250, 196, 120], (t - 0.55) / 0.45);
  if (Math.hypot(x - 330, y - 205) < 62) c = [255, 226, 160];
  if (y > ridge(far, x)) c = [70, 52, 96];
  if (y > ridge(near, x)) c = [28, 24, 48];
  return c;
}

const raw = Buffer.alloc((W * 4 + 1) * H);
for (let y = 0; y < H; y++) {
  raw[y * (W * 4 + 1)] = 0; // filter: none
  for (let x = 0; x < W; x++) {
    let acc = [0, 0, 0];
    for (let sy = 0; sy < SS; sy++)
      for (let sx = 0; sx < SS; sx++) {
        const c = colorAt(x + (sx + 0.5) / SS, y + (sy + 0.5) / SS);
        acc = acc.map((v, i) => v + c[i]);
      }
    const o = y * (W * 4 + 1) + 1 + x * 4;
    raw[o] = Math.round(acc[0] / (SS * SS));
    raw[o + 1] = Math.round(acc[1] / (SS * SS));
    raw[o + 2] = Math.round(acc[2] / (SS * SS));
    raw[o + 3] = 255;
  }
}

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

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);
fs.writeFileSync(OUT, png);
console.log(`Wrote ${path.relative(ROOT, OUT)} (${png.length} bytes)`);
