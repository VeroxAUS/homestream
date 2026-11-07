// Draws the tray icons (4 states x 16/20/24 px), the status dots for the tray menu and the app icon into assets/.
// Run with: node apps/desktop/scripts/makeIcons.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';

const assets = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets');

const hex = (value) => [(value >> 16) & 255, (value >> 8) & 255, value & 255];
const GREY = hex(0x55555f);
const WHITE = [255, 255, 255];
const AMBER = hex(0xffb020);
const RED = hex(0xff453a);
const DARK = hex(0x1a1205);

function roundedRect(x, y, radius) {
  const dx = Math.max(Math.abs(x - 0.5) - (0.5 - radius), 0);
  const dy = Math.max(Math.abs(y - 0.5) - (0.5 - radius), 0);
  return dx * dx + dy * dy <= radius * radius;
}

function inTriangle(px, py, [a, b, c]) {
  const sign = (p, q, r) => (p[0] - r[0]) * (q[1] - r[1]) - (q[0] - r[0]) * (p[1] - r[1]);
  const p = [px, py];
  const d1 = sign(p, a, b);
  const d2 = sign(p, b, c);
  const d3 = sign(p, c, a);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
}

const PLAY = [
  [0.38, 0.27],
  [0.38, 0.73],
  [0.74, 0.5],
];

function scaled(triangle, factor) {
  const cx = triangle.reduce((sum, point) => sum + point[0], 0) / 3;
  const cy = triangle.reduce((sum, point) => sum + point[1], 0) / 3;
  return triangle.map(([x, y]) => [cx + (x - cx) * factor, cy + (y - cy) * factor]);
}

function gradient(x, y) {
  const t = (x + y) / 2;
  return [255 + (229 - 255) * t, 61 + (9 - 61) * t, 71 + (20 - 71) * t];
}

function badge(x, y, fill) {
  const inside = (x - 0.74) ** 2 + (y - 0.74) ** 2 <= 0.27 ** 2;
  if (!inside) return null;
  const bar = Math.abs(x - 0.74) <= 0.04 && y >= 0.58 && y <= 0.78;
  const dot = (x - 0.74) ** 2 + (y - 0.88) ** 2 <= 0.045 ** 2;
  return bar || dot ? DARK : fill;
}

/** The colour at a point of a unit square, or null where the icon is transparent. */
function logoPixel(state, x, y) {
  if (state !== 'dot') {
    const extra = state === 'warn' ? badge(x, y, AMBER) : state === 'error' ? badge(x, y, RED) : null;
    if (extra) return extra;
  }
  if (!roundedRect(x, y, 0.22)) return null;
  if (state === 'stopped') {
    const outline = inTriangle(x, y, PLAY) && !inTriangle(x, y, scaled(PLAY, 0.55));
    return outline ? WHITE : GREY;
  }
  if (inTriangle(x, y, PLAY)) return WHITE;
  return state === 'error' ? GREY : gradient(x, y);
}

function dotPixel(color) {
  return (x, y) => ((x - 0.5) ** 2 + (y - 0.5) ** 2 <= 0.36 ** 2 ? color : null);
}

function render(size, pixelAt) {
  const samples = 4;
  const data = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let covered = 0;
      for (let sample = 0; sample < samples * samples; sample += 1) {
        const sx = sample % samples;
        const sy = Math.floor(sample / samples);
        const colour = pixelAt((px + (sx + 0.5) / samples) / size, (py + (sy + 0.5) / samples) / size);
        if (!colour) continue;
        r += colour[0];
        g += colour[1];
        b += colour[2];
        covered += 1;
      }
      const offset = (py * size + px) * 4;
      if (covered > 0) {
        data[offset] = Math.round(r / covered);
        data[offset + 1] = Math.round(g / covered);
        data[offset + 2] = Math.round(b / covered);
        data[offset + 3] = Math.round((covered / (samples * samples)) * 255);
      }
    }
  }
  return data;
}

function chunk(type, body) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, 'ascii');
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
  return Buffer.concat([head, body, tail]);
}

function png(size, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 6, 0, 0, 0], 8);
  const rows = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    rows[y * (size * 4 + 1)] = 0;
    rgba.copy(rows, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(path.join(assets, 'tray'), { recursive: true });
for (const state of ['ok', 'warn', 'error', 'stopped']) {
  for (const size of [16, 20, 24]) {
    writeFileSync(
      path.join(assets, 'tray', `${state}-${size}.png`),
      png(
        size,
        render(size, (x, y) => logoPixel(state, x, y)),
      ),
    );
  }
}
const dots = { ok: hex(0x46d369), warn: AMBER, error: RED, stopped: hex(0x8a8a96) };
for (const [state, colour] of Object.entries(dots)) {
  writeFileSync(path.join(assets, 'tray', `dot-${state}.png`), png(16, render(16, dotPixel(colour))));
}
writeFileSync(
  path.join(assets, 'app.png'),
  png(
    256,
    render(256, (x, y) => logoPixel('ok', x, y)),
  ),
);
