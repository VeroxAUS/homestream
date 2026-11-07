import { AppError } from '../errors.js';

/**
 * When AIOStreams cannot serve a file it redirects to a short clip of its own (`/static/<reason>.mp4`) instead of failing.
 * The clip may sit on any host and behind a path prefix, and the Location may be relative or carry a query string; only the
 * path counts.
 */
const PLACEHOLDER_PATH = /(?:^|\/)static\/([^/]+)\.mp4$/i;

/** A listing below this size says too little to judge a file by it. */
export const MIN_LISTED_BYTES_FOR_SIZE_CHECK = 20 * 1024 * 1024;
const MIN_PLAUSIBLE_FRACTION = 0.1;

/** Lower-case clip name (`downloading`, `429`, ...) when `target` is one of the gateway's placeholder clips, else null. */
export function placeholderName(target: URL): string | null {
  const match = PLACEHOLDER_PATH.exec(target.pathname);
  return match ? (match[1] as string).toLowerCase() : null;
}

/**
 * A "file" much smaller than its listing is the gateway's clip served without a redirect (a few MB against a multi-GB
 * release). Short real titles list a small size and pass; an unknown size on either side is not judged.
 */
export function clipSizeImplausible(listedBytes: number, actualBytes: number | null): boolean {
  if (!Number.isFinite(listedBytes) || listedBytes < MIN_LISTED_BYTES_FOR_SIZE_CHECK) return false;
  if (actualBytes === null || !Number.isFinite(actualBytes) || actualBytes <= 0) return false;
  return actualBytes < listedBytes * MIN_PLAUSIBLE_FRACTION;
}

function unavailable(reason: string): AppError {
  return new AppError(
    502,
    'stream_unavailable',
    `Could not open the selected stream: ${reason}`,
    'Try again in a moment. If it keeps failing, check the TorBox account on the health dashboard.',
  );
}

/** The error for one of the gateway's placeholder clips, by clip name. */
export function placeholderError(name: string): AppError {
  switch (name) {
    case 'downloading':
      return new AppError(
        409,
        'stream_not_cached',
        'This stream is not cached on TorBox yet.',
        'TorBox has to download it first. Try again later, or play a title that shows the ⚡ cached mark.',
      );
    case 'store_limit_exceeded':
      return new AppError(
        409,
        'torbox_slots_full',
        'TorBox has no free download slots right now.',
        'Wait for a running TorBox download to finish or remove one in the TorBox dashboard, then try again.',
      );
    case '429':
      return new AppError(
        429,
        'gateway_rate_limited',
        'The stream gateway is rate limited right now.',
        'Wait a minute and try again.',
      );
    default:
      return unavailable('the gateway has no playable file for it');
  }
}

/** What one redirect looked like, with nothing in it that identifies a host, token or file. */
export interface RedirectShape {
  status: number;
  host: 'same' | 'other';
  path: string;
  query: boolean;
}

const FILE_EXTENSIONS = new Set(['mp4', 'mkv', 'avi', 'mov', 'webm', 'ts', 'm3u8', 'json']);

function segmentClass(segment: string): string {
  if (segment === 'static') return segment;
  if (/^\d+$/.test(segment)) return '<num>';
  if (/^[0-9a-f]{12,}$/i.test(segment)) return '<id>';
  if (/^[a-z_]{1,24}$/i.test(segment)) return '<word>';
  return '<name>';
}

function pathPattern(pathname: string): string {
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length === 0) return '/';
  const classes = segments.map((segment, index) => {
    if (index < segments.length - 1) return segmentClass(segment);
    const dot = segment.lastIndexOf('.');
    const extension = dot > 0 ? segment.slice(dot + 1).toLowerCase() : '';
    return FILE_EXTENSIONS.has(extension)
      ? `${segmentClass(segment.slice(0, dot))}.${extension}`
      : segmentClass(segment);
  });
  return `/${classes.join('/')}`;
}

/** The shape of a redirect to `next`, answered by `from`: for a debug line that must never carry a URL. */
export function redirectShape(status: number, next: URL, from: string): RedirectShape {
  return {
    status,
    host: next.host === new URL(from).host ? 'same' : 'other',
    path: pathPattern(next.pathname),
    query: next.search.length > 1,
  };
}
