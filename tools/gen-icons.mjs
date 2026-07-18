/* Dependency-free PWA icon generator: renders a white asterisk (＋ over ×,
   the "mental math" star) on the app blue, and writes PNGs with a minimal
   encoder (zlib deflate + hand-rolled chunks). Run: node tools/gen-icons.mjs */

import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "icons");
mkdirSync(OUT, { recursive: true });

/* ---------- PNG encoding ---------- */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeB = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeB, data])));
  return Buffer.concat([len, typeB, data, crc]);
}

function encodePNG(size, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const stride = size * 4;
  const raw = Buffer.alloc(size * (stride + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

/* ---------- drawing ---------- */
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(ax + t * dx - px, ay + t * dy - py);
}

function roundedRectInside(px, py, size, radius) {
  const qx = Math.abs(px - size / 2) - (size / 2 - radius);
  const qy = Math.abs(py - size / 2) - (size / 2 - radius);
  const ox = Math.max(qx, 0);
  const oy = Math.max(qy, 0);
  return Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - radius <= 0;
}

const BLUE = [43, 80, 224]; // #2B50E0
const WHITE = [255, 255, 255];

function renderIcon(size, { fullBleed = false, glyphScale = 0.3 } = {}) {
  const px = Buffer.alloc(size * size * 4);
  const c = size / 2;
  const cornerR = size * 0.21;
  const armPlus = size * glyphScale; // half-length of + arms
  const armX = size * glyphScale * 0.78; // diagonals slightly shorter
  const thick = size * glyphScale * 0.15; // capsule radius
  const dxy = armX / Math.SQRT2;
  const arms = [
    [c - armPlus, c, c + armPlus, c],
    [c, c - armPlus, c, c + armPlus],
    [c - dxy, c - dxy, c + dxy, c + dxy],
    [c - dxy, c + dxy, c + dxy, c - dxy],
  ];
  const SS = 3; // supersampling grid per pixel
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let bgCov = 0;
      let glCov = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const fx = x + (sx + 0.5) / SS;
          const fy = y + (sy + 0.5) / SS;
          const inBg = fullBleed || roundedRectInside(fx, fy, size, cornerR);
          if (!inBg) continue;
          bgCov++;
          for (const [ax, ay, bx, by] of arms) {
            if (segDist(fx, fy, ax, ay, bx, by) <= thick) {
              glCov++;
              break;
            }
          }
        }
      }
      const total = SS * SS;
      const g = glCov / total;
      const a = bgCov / total;
      const i = (y * size + x) * 4;
      px[i] = Math.round(BLUE[0] * (1 - g) + WHITE[0] * g);
      px[i + 1] = Math.round(BLUE[1] * (1 - g) + WHITE[1] * g);
      px[i + 2] = Math.round(BLUE[2] * (1 - g) + WHITE[2] * g);
      px[i + 3] = Math.round(a * 255);
    }
  }
  return encodePNG(size, px);
}

const targets = [
  ["icon-192.png", 192, { fullBleed: false, glyphScale: 0.3 }],
  ["icon-512.png", 512, { fullBleed: false, glyphScale: 0.3 }],
  ["icon-maskable-512.png", 512, { fullBleed: true, glyphScale: 0.24 }],
  ["apple-touch-icon.png", 180, { fullBleed: true, glyphScale: 0.28 }],
];

for (const [name, size, opts] of targets) {
  writeFileSync(join(OUT, name), renderIcon(size, opts));
  console.log("wrote icons/" + name);
}
