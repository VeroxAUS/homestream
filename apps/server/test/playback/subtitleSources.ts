import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { run } from './harness.js';

export interface Cue {
  startSec: number;
  endSec: number;
  text: string;
}

export const TEXT_CUES: Cue[] = [
  { startSec: 2, endSec: 5, text: 'First text cue' },
  { startSec: 10, endSec: 14, text: 'Second text cue' },
  { startSec: 30, endSec: 34, text: 'Last text cue' },
];

export const BITMAP_CUES: Cue[] = [
  { startSec: 4, endSec: 9, text: 'Bitmap subtitle one' },
  { startSec: 20, endSec: 26, text: 'Bitmap subtitle two' },
];

const CANVAS = { width: 720, height: 480 };
const SECTOR = 2048;
const FONT = 'C\\:/Windows/Fonts/arial.ttf';

function srtTime(sec: number): string {
  const ms = Math.round(sec * 1000);
  const pad = (value: number, size: number) => String(value).padStart(size, '0');
  return `${pad(Math.floor(ms / 3_600_000), 2)}:${pad(Math.floor(ms / 60_000) % 60, 2)}:${pad(Math.floor(ms / 1000) % 60, 2)},${pad(ms % 1000, 3)}`;
}

export function toSrt(cues: Cue[]): string {
  return cues.map((cue, i) => `${i + 1}\n${srtTime(cue.startSec)} --> ${srtTime(cue.endSec)}\n${cue.text}\n`).join('\n');
}

interface Bitmap {
  width: number;
  height: number;
  /** 0 = transparent, 1 = outline, 2 = text. */
  pixels: Uint8Array;
}

async function renderText(text: string, dir: string): Promise<Bitmap> {
  const width = 480;
  const height = 56;
  const raw = path.join(dir, 'glyphs.raw');
  const filter = `drawtext=fontfile='${FONT}':text='${text}':fontsize=34:fontcolor=white:borderw=2:bordercolor=black:x=(w-text_w)/2:y=(h-text_h)/2`;
  await run('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `color=c=gray:s=${width}x${height}:d=1,${filter}`,
    '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'gray', raw,
  ]);
  const gray = readFileSync(raw);
  const pixels = new Uint8Array(width * height);
  for (let i = 0; i < pixels.length; i += 1) {
    const value = gray[i] as number;
    pixels[i] = value > 200 ? 2 : value < 60 ? 1 : 0;
  }
  return { width, height, pixels };
}

function encodeField(bitmap: Bitmap, firstLine: number): Buffer {
  const nibbles: number[] = [];
  const put = (value: number, count: number) => {
    for (let shift = (count - 1) * 4; shift >= 0; shift -= 4) nibbles.push((value >> shift) & 0xf);
  };
  for (let y = firstLine; y < bitmap.height; y += 2) {
    let x = 0;
    while (x < bitmap.width) {
      const color = bitmap.pixels[y * bitmap.width + x] as number;
      let end = x;
      while (end < bitmap.width && bitmap.pixels[y * bitmap.width + end] === color) end += 1;
      let run = end - x;
      if (end === bitmap.width) {
        put(color, 4);
      } else {
        while (run > 0) {
          const part = Math.min(run, 255);
          const size = part <= 3 ? 1 : part <= 15 ? 2 : part <= 63 ? 3 : 4;
          put((part << 2) | color, size);
          run -= part;
        }
      }
      x = end;
    }
    if (nibbles.length % 2 === 1) nibbles.push(0);
  }
  const bytes = Buffer.alloc(nibbles.length / 2);
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = ((nibbles[2 * i] as number) << 4) | (nibbles[2 * i + 1] as number);
  return bytes;
}

function area(x1: number, x2: number, y1: number, y2: number): Buffer {
  return Buffer.from([x1 >> 4, ((x1 & 0xf) << 4) | (x2 >> 8), x2 & 0xff, y1 >> 4, ((y1 & 0xf) << 4) | (y2 >> 8), y2 & 0xff]);
}

function spuPacket(bitmap: Bitmap, durationMs: number): Buffer {
  const top = encodeField(bitmap, 0);
  const bottom = encodeField(bitmap, 1);
  const x1 = Math.floor((CANVAS.width - bitmap.width) / 2);
  const y1 = CANVAS.height - bitmap.height - 40;
  const topOffset = 4;
  const bottomOffset = topOffset + top.length;
  const controlOffset = bottomOffset + bottom.length;
  const first = Buffer.concat([
    Buffer.from([0, 0, 0, 0]),
    Buffer.from([0x01, 0x03, 0x32, 0x10, 0x04, 0xff, 0xf0, 0x05]),
    area(x1, x1 + bitmap.width - 1, y1, y1 + bitmap.height - 1),
    Buffer.from([0x06, topOffset >> 8, topOffset & 0xff, bottomOffset >> 8, bottomOffset & 0xff, 0xff]),
  ]);
  const secondOffset = controlOffset + first.length;
  first.writeUInt16BE(secondOffset, 2);
  const ticks = Math.round((durationMs * 90) / 1024);
  const second = Buffer.from([ticks >> 8, ticks & 0xff, secondOffset >> 8, secondOffset & 0xff, 0x02, 0xff]);
  const body = Buffer.concat([top, bottom, first, second]);
  const header = Buffer.alloc(4);
  header.writeUInt16BE(4 + body.length, 0);
  header.writeUInt16BE(controlOffset, 2);
  return Buffer.concat([header, body]);
}

function pts(ms: number): Buffer {
  const value = Math.round(ms * 90);
  return Buffer.from([
    0x21 | ((value / 2 ** 29) & 0x0e),
    (value >>> 22) & 0xff,
    ((value >>> 14) & 0xfe) | 1,
    (value >>> 7) & 0xff,
    ((value << 1) & 0xfe) | 1,
  ]);
}

function sector(spu: Buffer, ms: number): Buffer {
  const pack = Buffer.from([0x00, 0x00, 0x01, 0xba, 0x44, 0x00, 0x04, 0x00, 0x04, 0x01, 0x01, 0x89, 0xc3, 0xf8]);
  const pesLength = 3 + 5 + 1 + spu.length;
  const pes = Buffer.concat([
    Buffer.from([0x00, 0x00, 0x01, 0xbd, pesLength >> 8, pesLength & 0xff, 0x81, 0x80, 0x05]),
    pts(ms),
    Buffer.from([0x20]),
    spu,
  ]);
  const used = pack.length + pes.length;
  if (used > SECTOR - 6) throw new Error(`Subtitle bitmap does not fit one VobSub sector (${used} bytes)`);
  const padding = Buffer.alloc(SECTOR - used, 0xff);
  padding.writeUInt16BE(padding.length - 6, 4);
  padding.set([0x00, 0x00, 0x01, 0xbe], 0);
  return Buffer.concat([pack, pes, padding]);
}

/** Writes a VobSub .idx/.sub pair that renders each cue as a bitmap; ffmpeg reads it as a dvd_subtitle stream. */
export async function writeVobsub(dir: string, name: string, cues: Cue[], language: string): Promise<string> {
  mkdirSync(dir, { recursive: true });
  const sectors: Buffer[] = [];
  const stamps: string[] = [];
  for (const cue of cues) {
    const bitmap = await renderText(cue.text, dir);
    const startMs = Math.round(cue.startSec * 1000);
    stamps.push(`timestamp: ${new Date(startMs).toISOString().slice(11, 19)}:${String(startMs % 1000).padStart(3, '0')}, filepos: ${(sectors.length * SECTOR).toString(16).padStart(9, '0')}`);
    sectors.push(sector(spuPacket(bitmap, (cue.endSec - cue.startSec) * 1000), startMs));
  }
  const palette = ['000000', '000000', 'ffffff', 'ff0000', ...Array<string>(12).fill('000000')].join(', ');
  const idx = [
    '# VobSub index file, v7 (do not modify this line!)',
    `size: ${CANVAS.width}x${CANVAS.height}`,
    `palette: ${palette}`,
    'langidx: 0',
    `id: ${language}, index: 0`,
    ...stamps,
    '',
  ].join('\n');
  writeFileSync(path.join(dir, `${name}.sub`), Buffer.concat(sectors));
  const idxPath = path.join(dir, `${name}.idx`);
  writeFileSync(idxPath, idx);
  return idxPath;
}

export interface SubtitleSources {
  /**
   * 720x480 H.264, 600 s, 24 fps (long enough that the encoder is still running when tests look for it). Streams: 0 video; 1 audio por (default-flagged, 440 Hz); 2 audio eng (5.1, 880 Hz);
   * 3 audio fra (1320 Hz); 4 subrip eng; 5 subrip por; 6 dvd_subtitle eng.
   */
  multi: string;
}

/** 4K HEVC Main10 tagged HDR10 (PQ/BT.2020), 5.1 AC3, 12 s, with the bitmap track as stream 2. */
export async function generateHdrBitmapSource(dir: string): Promise<string> {
  mkdirSync(dir, { recursive: true });
  const idx = await writeVobsub(dir, 'bitmap-hdr', BITMAP_CUES.slice(0, 1), 'en');
  const file = path.join(dir, 'source-hdr-bitmap.mkv');
  await run('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=3840x2160:rate=24,format=p010le',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-i', idx, '-t', '12',
    '-map', '0:v', '-map', '1:a', '-map', '2:s',
    '-c:v', 'hevc_nvenc', '-profile:v', 'main10', '-pix_fmt', 'p010le', '-tag:v', 'hvc1',
    '-bsf:v', 'hevc_metadata=colour_primaries=9:transfer_characteristics=16:matrix_coefficients=9',
    '-c:a', 'ac3', '-ac', '6', '-c:s', 'copy', file,
  ]);
  return file;
}

export async function generateSubtitleSources(dir: string): Promise<SubtitleSources> {
  mkdirSync(dir, { recursive: true });
  const textSrt = path.join(dir, 'text.srt');
  const textPor = path.join(dir, 'text-por.srt');
  writeFileSync(textSrt, toSrt(TEXT_CUES));
  writeFileSync(textPor, toSrt(TEXT_CUES.map((cue) => ({ ...cue, text: `${cue.text} (pt)` }))));
  const idx = await writeVobsub(dir, 'bitmap', BITMAP_CUES, 'en');

  const multi = path.join(dir, 'source-subs.mkv');
  await run('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', `testsrc2=size=${CANVAS.width}x${CANVAS.height}:rate=24`,
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
    '-f', 'lavfi', '-i', 'sine=frequency=880:sample_rate=48000',
    '-f', 'lavfi', '-i', 'sine=frequency=1320:sample_rate=48000',
    '-i', textSrt, '-i', textPor, '-i', idx,
    '-t', '600',
    '-map', '0:v', '-map', '1:a', '-map', '2:a', '-map', '3:a', '-map', '4:s', '-map', '5:s', '-map', '6:s',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-g', '48',
    '-c:a:0', 'aac', '-ac:a:0', '2', '-c:a:1', 'ac3', '-ac:a:1', '6', '-c:a:2', 'aac', '-ac:a:2', '2',
    '-c:s:0', 'copy', '-c:s:1', 'copy', '-c:s:2', 'copy',
    '-metadata:s:a:0', 'language=por', '-metadata:s:a:1', 'language=eng', '-metadata:s:a:2', 'language=fra',
    '-metadata:s:a:1', 'title=English 5.1',
    '-metadata:s:s:0', 'language=eng', '-metadata:s:s:0', 'title=English',
    '-metadata:s:s:1', 'language=por', '-metadata:s:s:1', 'title=Portuguese',
    '-metadata:s:s:2', 'language=eng', '-metadata:s:s:2', 'title=English (bitmap)',
    '-disposition:a', '0', '-disposition:a:0', 'default', '-disposition:s', '0',
    multi,
  ]);
  return { multi };
}
