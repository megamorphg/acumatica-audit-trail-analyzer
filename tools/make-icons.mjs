// Generates icons/icon{16,48,128}.png.
//
// Written by hand rather than pulled from a package so the repo stays
// dependency-free (node's zlib is all a PNG encoder actually needs). Draws at
// 4x and box-downsamples, which is what keeps the 16px version legible.
//
//   node tools/make-icons.mjs

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32 } from './crc32.mjs';

const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'icons');

// ---------- PNG encoding ----------
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // truecolour with alpha
  // 10,11,12 = compression, filter, interlace — all zero

  // One filter byte (0 = none) per scanline.
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    const src = y * width * 4;
    const dst = y * (width * 4 + 1);
    raw[dst] = 0;
    rgba.copy(raw, dst + 1, src, src + width * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------- drawing ----------
const BLUE = [28, 110, 164, 255];
const WHITE = [255, 255, 255, 255];
const AMBER = [232, 160, 60, 255];

function makeCanvas(size) {
  return { size, px: Buffer.alloc(size * size * 4) };
}

function put(c, x, y, colour) {
  if (x < 0 || y < 0 || x >= c.size || y >= c.size) return;
  const i = (y * c.size + x) * 4;
  c.px[i] = colour[0];
  c.px[i + 1] = colour[1];
  c.px[i + 2] = colour[2];
  c.px[i + 3] = colour[3];
}

function fillRoundedRect(c, x0, y0, x1, y1, r, colour) {
  for (let y = Math.round(y0); y < Math.round(y1); y++) {
    for (let x = Math.round(x0); x < Math.round(x1); x++) {
      const dx = Math.max(x0 + r - x, 0, x - (x1 - r - 1));
      const dy = Math.max(y0 + r - y, 0, y - (y1 - r - 1));
      if (dx > 0 && dy > 0 && dx * dx + dy * dy > r * r) continue;
      put(c, x, y, colour);
    }
  }
}

function fillCircle(c, cx, cy, r, colour) {
  for (let y = Math.round(cy - r); y <= Math.round(cy + r); y++) {
    for (let x = Math.round(cx - r); x <= Math.round(cx + r); x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= r * r) put(c, x, y, colour);
    }
  }
}

/** A timeline: a spine with three events, each with a bar of change beside it. */
function draw(size) {
  const c = makeCanvas(size);
  const u = size / 128; // design in 128-unit space

  fillRoundedRect(c, 0, 0, size, size, 26 * u, BLUE);

  const spineX = 40 * u;
  fillRoundedRect(c, spineX - 2.5 * u, 26 * u, spineX + 2.5 * u, 102 * u, 2.5 * u, WHITE);

  const rows = [
    { y: 34, width: 54, colour: WHITE },
    { y: 64, width: 40, colour: AMBER },
    { y: 94, width: 48, colour: WHITE },
  ];

  for (const row of rows) {
    const y = row.y * u;
    fillCircle(c, spineX, y, 8 * u, row.colour);
    fillRoundedRect(c, 58 * u, y - 5 * u, (58 + row.width) * u, y + 5 * u, 5 * u, row.colour);
  }

  return c;
}

/** Box-downsample, which is what makes the small sizes readable. */
function downsample(src, target) {
  const factor = src.size / target;
  const out = makeCanvas(target);
  for (let y = 0; y < target; y++) {
    for (let x = 0; x < target; x++) {
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let sy = Math.floor(y * factor); sy < Math.floor((y + 1) * factor); sy++) {
        for (let sx = Math.floor(x * factor); sx < Math.floor((x + 1) * factor); sx++) {
          const i = (sy * src.size + sx) * 4;
          const alpha = src.px[i + 3];
          r += src.px[i] * alpha;
          g += src.px[i + 1] * alpha;
          b += src.px[i + 2] * alpha;
          a += alpha;
          n++;
        }
      }
      if (!n) continue;
      // Premultiplied average, so transparent pixels don't darken the edges.
      const i = (y * target + x) * 4;
      out.px[i] = a ? Math.round(r / a) : 0;
      out.px[i + 1] = a ? Math.round(g / a) : 0;
      out.px[i + 2] = a ? Math.round(b / a) : 0;
      out.px[i + 3] = Math.round(a / n);
    }
  }
  return out;
}

mkdirSync(outDir, { recursive: true });
const master = draw(512);
for (const size of [16, 48, 128]) {
  const c = downsample(master, size);
  writeFileSync(path.join(outDir, `icon${size}.png`), encodePng(size, size, c.px));
  console.log(`icons/icon${size}.png`);
}
