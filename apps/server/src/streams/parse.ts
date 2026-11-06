import type {
  StreamHdr,
  StreamOption,
  StreamResolution,
  StreamVideoCodec,
} from '@homestream/shared';
import type { GatewayStream } from '../gateway/types.js';

// Boundaries treat letters and digits as word characters; '.', '_', '-', brackets and spaces separate tokens.
const B = '(?<![a-z0-9])';
const E = '(?![a-z0-9])';

/** Lower-cases and turns separators into spaces, keeping dots between digits (5.1, H.264). */
export function normalizeFilename(filename: string): string {
  return filename
    .toLowerCase()
    .replace(/[_[\](){}",;:|]/g, ' ')
    // "AC3.5.1" / "H.264.5.1": the dot after a codec number is a separator, not a decimal point.
    .replace(/(264|265|ac ?-?3)\.(?=\d)/g, '$1 ')
    .replace(/(?<!\d)\.|\.(?!\d)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const test = (re: RegExp, text: string): boolean => re.test(text);

export function parseResolution(norm: string): StreamResolution {
  const explicit = new RegExp(`${B}(2160|1440|1080|720|576|480|360)[pi]${E}`).exec(norm);
  if (explicit) {
    switch (explicit[1]) {
      case '2160':
        return '2160p';
      case '1080':
        return '1080p';
      case '720':
        return '720p';
      case '576':
      case '480':
      case '360':
        return '480p';
      default:
        return 'unknown';
    }
  }
  if (test(new RegExp(`${B}(4k|uhd|3840x2160)${E}`), norm)) return '2160p';
  return 'unknown';
}

export function parseVideoCodec(norm: string): StreamVideoCodec {
  if (test(new RegExp(`${B}av1${E}`), norm)) return 'av1';
  if (test(new RegExp(`${B}(x ?265|h ?\\.?265|hevc)${E}`), norm)) return 'hevc';
  if (test(new RegExp(`${B}(x ?264|h ?\\.?264|avc)${E}`), norm)) return 'h264';
  return 'other';
}

export function parseHdr(norm: string, resolution: StreamResolution): StreamHdr {
  if (test(new RegExp(`${B}(dv|dovi|dolby ?vision)${E}`), norm)) return 'dv';
  if (test(new RegExp(`${B}hdr ?10 ?(\\+|plus)`), norm)) return 'hdr10+';
  if (test(new RegExp(`${B}hdr(?: ?10)?${E}`), norm)) return 'hdr10';
  if (test(new RegExp(`${B}hlg${E}`), norm)) return 'hlg';
  if (test(new RegExp(`${B}sdr${E}`), norm)) return 'sdr';
  return resolution === '1080p' || resolution === '720p' || resolution === '480p' ? 'sdr' : 'unknown';
}

export const SOURCES = ['Remux', 'BluRay', 'WEB-DL', 'WEBRip', 'HDTV'] as const;

export function parseSource(norm: string): string {
  if (test(/remux/, norm)) return 'Remux';
  if (test(new RegExp(`${B}web ?-?rip${E}`), norm)) return 'WEBRip';
  if (test(new RegExp(`${B}(web ?-?dl|webdl|web)${E}`), norm)) return 'WEB-DL';
  if (test(new RegExp(`${B}(blu ?-?ray|bd ?-?rip|br ?-?rip|bd|bdmv)${E}`), norm)) return 'BluRay';
  if (test(new RegExp(`${B}(hdtv|pdtv|tvrip|dvbrip)${E}`), norm)) return 'HDTV';
  if (test(new RegExp(`${B}dvd(rip)?${E}`), norm)) return 'DVD';
  return 'Unknown';
}

interface AudioPattern {
  re: RegExp;
  label: string;
}

const AUDIO_PATTERNS: AudioPattern[] = [
  { re: new RegExp(`${B}true ?-?hd`), label: 'TrueHD' },
  { re: new RegExp(`${B}dts ?-?hd ?-?(ma|master)`), label: 'DTS-HD MA' },
  { re: new RegExp(`${B}dts ?-?hd`), label: 'DTS-HD' },
  { re: new RegExp(`${B}dts ?-?x${E}`), label: 'DTS:X' },
  { re: new RegExp(`${B}dts`), label: 'DTS' },
  { re: new RegExp(`${B}(ddp|dd\\+|dd plus|e ?-?ac ?-?3)`), label: 'EAC3' },
  { re: new RegExp(`${B}(dd|ac ?-?3|dolby digital)(?![a-z])`), label: 'AC3' },
  { re: new RegExp(`${B}aac`), label: 'AAC' },
  { re: new RegExp(`${B}flac${E}`), label: 'FLAC' },
  { re: new RegExp(`${B}opus${E}`), label: 'Opus' },
  { re: new RegExp(`${B}l?pcm${E}`), label: 'PCM' },
  { re: new RegExp(`${B}mp3${E}`), label: 'MP3' },
];

function parseChannels(norm: string, from: number): string | null {
  const dotted = /(?<![0-9.])([1-8])\.([01])(?![0-9])/.exec(norm);
  if (dotted) return `${dotted[1]}.${dotted[2]}`;
  const spaced = /(?<![0-9])([2-8]) ([01])(?![0-9])/.exec(norm.slice(from, from + 24));
  if (spaced) return `${spaced[1]}.${spaced[2]}`;
  const ch = /(?<![0-9])(8|6|2) ?ch(?![a-z])/.exec(norm);
  if (ch) return ch[1] === '8' ? '7.1' : ch[1] === '6' ? '5.1' : '2.0';
  return null;
}

export function parseAudio(norm: string): string {
  for (const { re, label } of AUDIO_PATTERNS) {
    const match = re.exec(norm);
    if (!match) continue;
    const atmos = test(new RegExp(`${B}(atmos|ddpa)`), norm) && (label === 'TrueHD' || label === 'EAC3');
    const channels = parseChannels(norm, match.index);
    return [label + (atmos ? ' Atmos' : ''), channels].filter(Boolean).join(' ');
  }
  const atmos = new RegExp(`${B}atmos`).exec(norm);
  if (atmos) return ['Atmos', parseChannels(norm, atmos.index)].filter(Boolean).join(' ');
  return 'Unknown';
}

const LANGUAGE_PATTERNS: Array<[string, string]> = [
  ['eng', 'eng|english'],
  ['rus', 'rus|russian'],
  ['ukr', 'ukr|ukrainian'],
  ['bel', 'bel|belarusian'],
  ['fre', 'fre|fra|french|vff|vfq|vf2|vfi|truefrench'],
  ['ger', 'ger|deu|german'],
  ['ita', 'ita|italian'],
  ['spa', 'spa|spanish|castellano|latino'],
  ['por', 'por|portuguese|dublado'],
  ['pol', 'pol|polish|lektor'],
  ['cze', 'cze|ces|czech'],
  ['jpn', 'jpn|japanese'],
  ['kor', 'kor|korean'],
  ['chi', 'chi|chinese|mandarin'],
  ['hin', 'hin|hindi'],
  ['tur', 'tur|turkish'],
  ['ara', 'ara|arabic'],
];

export function parseLanguages(filename: string, norm: string): string[] {
  const found: Array<{ code: string; index: number }> = [];
  for (const [code, words] of LANGUAGE_PATTERNS) {
    const match = new RegExp(`${B}(?:\\d+x)?(?:${words})${E}`).exec(norm);
    if (match) found.push({ code, index: match.index });
  }
  if (/[\u0400-\u04ff]/.test(filename) && !found.some((item) => item.code === 'rus')) {
    found.push({ code: 'rus', index: 0 });
  }
  return found.sort((a, b) => a.index - b.index).map((item) => item.code);
}

const HDR_LABELS: Partial<Record<StreamHdr, string>> = {
  dv: 'Dolby Vision',
  'hdr10+': 'HDR10+',
  hdr10: 'HDR10',
  hlg: 'HLG',
};
const CODEC_LABELS: Partial<Record<StreamVideoCodec, string>> = { hevc: 'HEVC', h264: 'H.264', av1: 'AV1' };

export function formatSize(bytes: number): string {
  if (bytes <= 0) return '';
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  return `${Math.max(1, Math.round(bytes / 1e6))} MB`;
}

function buildLabel(option: Omit<StreamOption, 'label'>): string {
  return [
    option.resolution === 'unknown' ? null : option.resolution,
    HDR_LABELS[option.hdr],
    CODEC_LABELS[option.videoCodec],
    option.source === 'Unknown' ? null : option.source,
    option.audio === 'Unknown' ? null : option.audio,
    formatSize(option.sizeBytes) || null,
    option.cached ? 'Cached' : 'Not cached',
  ]
    .filter(Boolean)
    .join(' · ');
}

/** Gateway cached marker: ⚡ = cached on TorBox, ⏳ = needs downloading first. */
export function isCachedName(name: string): boolean {
  return name.includes('\u26A1');
}

export function parseStream(raw: GatewayStream): StreamOption {
  const norm = normalizeFilename(raw.filename);
  const resolution = parseResolution(norm);
  const base: Omit<StreamOption, 'label'> = {
    id: raw.id,
    resolution,
    videoCodec: parseVideoCodec(norm),
    hdr: parseHdr(norm, resolution),
    audio: parseAudio(norm),
    source: parseSource(norm),
    sizeBytes: raw.videoSize,
    cached: raw.cached ?? isCachedName(raw.name),
    filename: raw.filename,
    languages: parseLanguages(raw.filename, norm),
  };
  return { ...base, label: buildLabel(base) };
}
