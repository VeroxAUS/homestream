/**
 * Scrubbing shared by every telemetry sink (Sentry events and breadcrumbs, PostHog properties, logs of the web, desktop and
 * TV clients). Pure string and object functions: no Node APIs, so the browser bundle can use them too. Secrets that only the
 * running process knows (API keys from the config) are passed in as `extra`.
 */

export const SCRUBBED = '[redacted]';
export const HOME_PLACEHOLDER = '<home>';

export type TextScrubber = (text: string) => string;

const URL_PATTERN = /\b(?:https?|wss?|ftp|file):\/\/[^\s"'<>\\)\]]+/gi;
const ADDON_PATH = /\/stremio\/[^\s"'<>\\]+/gi;
const CDN_DOMAIN = /tb-cdn\.io\b/gi;
const HOST_CHAR = /[a-z0-9.-]/i;
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]{6,}/gi;
const JWT = /\beyJ[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]+){0,2}/g;
const SERVICE_KEY = /\b(?:sntry[su]_|ph[cx]_)[A-Za-z0-9]{8,}/g;
// 40+ characters mixing letters and digits is a key or token, never prose or a UUID (36 characters).
// The letter and digit test runs on the match, not in lookaheads, which rescan the whole run from every word boundary.
const LONG_TOKEN = /\b[A-Za-z0-9_-]{40,}\b/g;
const HAS_DIGIT = /\d/;
const HAS_LETTER = /[A-Za-z]/;
const SECRET_FIELD =
  /\b(token|api[_-]?key|apikey|access_token|auth|authorization|password|secret|signature|sig)\b(["']?\s*[=:]\s*["']?)(?!\[redacted\])([^\s"'&,;]{4,})/gi;
const QUERY_STRING = /\?[^\s"'#?]*=[^\s"'#]*/g;
const IPV4 = /\b(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}\b/g;
// A match only counts with a `::` or at least six groups (see hasIpv6Shape), so clock times such as 12:30:45 are left alone.
const IPV6 = /(?<![\w:])(?:[0-9a-f]{0,4}:){2,}[0-9a-f]{0,4}(?![\w:])/gi;
const WINDOWS_HOME = /\b[A-Za-z]:[\\/]+Users[\\/]+[^\\/\s"'<>:*?|]+/gi;
const POSIX_HOME = /(^|[\s"'(=])\/(?:Users|home)\/[^/\s"'<>]+/g;

/** Field names whose value is never sent, whatever it holds. */
const DENIED_KEYS = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'api_key',
  'apikey',
  'token',
  'access_token',
  'password',
  'secret',
  'ip_address',
  'ip',
  'server_name',
  'hostname',
  'username',
  'user',
  'email',
]);

/**
 * Replaces the CDN domain together with the sub-domain labels in front of it. Found from the domain outwards because a
 * pattern of repeated labels in front of the domain is quadratic on a long label-like string that lacks it.
 */
function scrubCdnHosts(text: string): string {
  let out = '';
  let copied = 0;
  for (const match of text.matchAll(CDN_DOMAIN)) {
    let start = match.index;
    while (start > copied && HOST_CHAR.test(text.charAt(start - 1))) start -= 1;
    while (start < match.index && /[.-]/.test(text.charAt(start))) start += 1;
    out += text.slice(copied, start) + SCRUBBED;
    copied = match.index + match[0].length;
  }
  return out + text.slice(copied);
}

function hasIpv6Shape(candidate: string): boolean {
  return candidate.includes('::') || candidate.split(':').length >= 6;
}

/** Scrubs one string. `extra` runs first so registered secrets are removed before any pattern can split them. */
export function sanitizeText(input: string, extra?: TextScrubber): string {
  let out = extra ? extra(input) : input;
  out = out.replace(URL_PATTERN, SCRUBBED);
  out = out.replace(ADDON_PATH, SCRUBBED);
  out = scrubCdnHosts(out);
  out = out.replace(BEARER, `Bearer ${SCRUBBED}`);
  out = out.replace(JWT, SCRUBBED);
  out = out.replace(SERVICE_KEY, SCRUBBED);
  out = out.replace(SECRET_FIELD, `$1$2${SCRUBBED}`);
  out = out.replace(QUERY_STRING, `?${SCRUBBED}`);
  out = out.replace(WINDOWS_HOME, HOME_PLACEHOLDER);
  out = out.replace(POSIX_HOME, `$1${HOME_PLACEHOLDER}`);
  out = out.replace(IPV4, SCRUBBED);
  out = out.replace(IPV6, (match) => (hasIpv6Shape(match) ? SCRUBBED : match));
  out = out.replace(LONG_TOKEN, (match) => (HAS_DIGIT.test(match) && HAS_LETTER.test(match) ? SCRUBBED : match));
  return out;
}

const MAX_DEPTH = 12;

function walk(value: unknown, extra: TextScrubber | undefined, seen: WeakSet<object>, depth: number): unknown {
  if (typeof value === 'string') return sanitizeText(value, extra);
  if (value === null || typeof value !== 'object') return value;
  if (depth >= MAX_DEPTH || seen.has(value)) return SCRUBBED;
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => walk(item, extra, seen, depth + 1));
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (DENIED_KEYS.has(key.toLowerCase())) continue;
    result[key] = walk(item, extra, seen, depth + 1);
  }
  return result;
}

/** Deep copy with every string scrubbed and every denied field (auth, cookies, user, ip, server name) removed. */
export function sanitizeValue<T>(value: T, extra?: TextScrubber): T {
  return walk(value, extra, new WeakSet(), 0) as T;
}

interface Frame {
  filename?: string;
  abs_path?: string;
}

/** A `/\/+$/` replace is quadratic on a long run of slashes that does not end the string. */
function trimTrailingSlashes(text: string): string {
  let end = text.length;
  while (end > 0 && text.charCodeAt(end - 1) === 47) end -= 1;
  return text.slice(0, end);
}

/** Turns an absolute file path into one relative to the repository (or installed app) root. */
export function relativizePath(file: string, roots: readonly string[]): string {
  const normalized = file.replace(/\\/g, '/');
  for (const root of roots) {
    const base = trimTrailingSlashes(root.replace(/\\/g, '/'));
    if (base && normalized.toLowerCase().startsWith(`${base.toLowerCase()}/`)) return normalized.slice(base.length + 1);
  }
  return file;
}

function relativizeFrames(event: Record<string, unknown>, roots: readonly string[]): void {
  const values = (event.exception as { values?: Array<{ stacktrace?: { frames?: Frame[] } }> } | undefined)?.values;
  for (const value of values ?? []) {
    for (const frame of value.stacktrace?.frames ?? []) {
      if (frame.filename) frame.filename = relativizePath(frame.filename, roots);
      if (frame.abs_path) frame.abs_path = relativizePath(frame.abs_path, roots);
    }
  }
}

/** Device facts that help to reproduce a problem and say nothing about who or where the machine is. */
const DEVICE_KEEP = new Set(['arch', 'processor_count', 'memory_size']);

/** Drops locale and timezone, the machine name and the boot time; keeps OS, runtime and coarse hardware facts. */
function trimContexts(contexts: Record<string, Record<string, unknown>> | undefined): void {
  if (!contexts) return;
  delete contexts.culture;
  const { device } = contexts;
  if (!device) return;
  for (const key of Object.keys(device)) if (!DEVICE_KEEP.has(key)) delete device[key];
}

export interface EventSanitizeOptions {
  extra?: TextScrubber;
  /** Directories whose prefix is cut from stack-frame paths (repository root, install directory). */
  roots?: readonly string[];
}

/**
 * An event without a user still gets the sender's connection address (and a geo location derived from it) from Sentry's
 * ingestion, which the SDK options cannot prevent for server platforms. `sdk.settings.infer_ip: "never"` is the
 * protocol switch that tells ingestion to keep exactly what the client sent.
 */
function forbidIpInference(event: Record<string, unknown>): void {
  const sdk = (event.sdk ?? {}) as Record<string, unknown>;
  event.sdk = { ...sdk, settings: { ...(sdk.settings as object | undefined), infer_ip: 'never' } };
}

/**
 * Sentry error or transaction event: no user, IP, server name or request data, ingestion told not to infer an IP;
 * frames relative; every string scrubbed.
 */
export function sanitizeSentryEvent<T extends object>(event: T, options: EventSanitizeOptions = {}): T {
  const draft = event as Record<string, unknown>;
  relativizeFrames(draft, options.roots ?? []);
  const clean = sanitizeValue(draft, options.extra);
  forbidIpInference(clean);
  delete clean.server_name;
  delete clean.user;
  delete clean.request;
  trimContexts(clean.contexts as Record<string, Record<string, unknown>> | undefined);
  return clean as T;
}

/** Breadcrumbs keep their category, level and message; all text is scrubbed and request data is dropped. */
export function sanitizeBreadcrumb<T extends object>(breadcrumb: T, extra?: TextScrubber): T {
  return sanitizeValue(breadcrumb, extra);
}
