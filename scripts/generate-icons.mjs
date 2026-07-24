// Generates the app's PWA icons procedurally — no binary assets committed,
// no external image dependencies. Draws a lime "location pin" glyph on a
// warm-dark background to match the in-app theme.
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '..', 'public');
mkdirSync(OUT, { recursive: true });

// ── CRC32 + PNG encoder ────────────────────────────────
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePNG(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type RGBA
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── Drawing ────────────────────────────────────────────
const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
const mix = (a, b, t) => a + (b - a) * t;

function drawIcon(S, maskable) {
  const rgba = Buffer.alloc(S * S * 4);
  const scale = maskable ? 0.72 : 0.92; // shrink design for maskable safe area
  const cx = S / 2;
  const cyPin = S * (maskable ? 0.44 : 0.42);
  const R = S * 0.26 * scale;
  const tipY = S * (maskable ? 0.82 : 0.86) * (maskable ? 1 : 1);
  const holeR = R * 0.4;
  const corner = maskable ? 0 : S * 0.22;

  const bgTop = [18, 22, 18];
  const bgBot = [7, 8, 7];
  const limeTop = [212, 255, 92];
  const limeBot = [160, 220, 40];

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4;

      // Background (rounded square with vertical gradient + soft glow).
      let inBg = true;
      if (!maskable) {
        // rounded-rect test
        const rx = Math.max(corner - x, x - (S - corner), 0);
        const ry = Math.max(corner - y, y - (S - corner), 0);
        if (Math.hypot(rx, ry) > corner) inBg = false;
      }

      const gt = y / S;
      let r = mix(bgTop[0], bgBot[0], gt);
      let g = mix(bgTop[1], bgBot[1], gt);
      let b = mix(bgTop[2], bgBot[2], gt);

      // subtle lime glow near the pin
      const glow = Math.max(
        0,
        1 - Math.hypot(x - cx, y - cyPin) / (S * 0.5),
      );
      r += glow * 14;
      g += glow * 22;
      b += glow * 6;

      let a = inBg ? 255 : 0;

      // Pin shape (teardrop = top disk ∪ tapering triangle to tip).
      const dTop = Math.hypot(x - cx, y - cyPin);
      let inPin = dTop <= R;
      if (!inPin && y >= cyPin && y <= tipY) {
        const halfW = (R * (tipY - y)) / (tipY - cyPin);
        if (Math.abs(x - cx) <= halfW) inPin = true;
      }

      if (inPin && inBg) {
        const pt = (y - (cyPin - R)) / (tipY - (cyPin - R));
        let pr = mix(limeTop[0], limeBot[0], pt);
        let pg = mix(limeTop[1], limeBot[1], pt);
        let pb = mix(limeTop[2], limeBot[2], pt);

        // Inner hole (dark).
        if (dTop <= holeR) {
          pr = 12;
          pg = 16;
          pb = 8;
        }
        r = pr;
        g = pg;
        b = pb;
        a = 255;
      }

      rgba[i] = clamp(r);
      rgba[i + 1] = clamp(g);
      rgba[i + 2] = clamp(b);
      rgba[i + 3] = a;
    }
  }
  return encodePNG(S, S, rgba);
}

const targets = [
  ['pwa-192x192.png', 192, false],
  ['pwa-512x512.png', 512, false],
  ['pwa-maskable-512x512.png', 512, true],
  ['apple-touch-icon.png', 180, false],
  ['favicon-48x48.png', 48, false],
];

for (const [name, size, maskable] of targets) {
  writeFileSync(join(OUT, name), drawIcon(size, maskable));
  console.log(`wrote public/${name} (${size}×${size})`);
}
