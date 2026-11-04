export const REDACTED = '<redacted>';

const MIN_SECRET_LENGTH = 6;
const secrets = new Set<string>();

// Words that terminate the secret part of an addon URL: https://host/stremio/<secret>/<secret>/manifest.json
const ADDON_RESOURCE = '(?:manifest\\.json|stream\\/|catalog\\/|meta\\/|subtitles\\/|configure)';
const ADDON_PATH = new RegExp(`(\\/stremio\\/)(?:[^\\/\\s"'\\\\?#]+\\/)+?(?=${ADDON_RESOURCE})`, 'gi');
const SECRET_PARAM =
  /([?&;\s"'])(token|apikey|api_key|api-key|key|access_token|auth|authorization|password|secret|sig|signature)=([^&\s"'\\]+)/gi;
const BEARER = /\b(Bearer)\s+[A-Za-z0-9._~+/=-]{6,}/gi;
const JWT = /\beyJ[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]+){0,2}/g;
const CDN_URL = /(https?:\/\/[^\s/"'\\]*tb-cdn\.io)\/[^\s"'\\]*/gi;

export function registerSecret(value: string | null | undefined): void {
  const trimmed = value?.trim();
  if (trimmed && trimmed.length >= MIN_SECRET_LENGTH) secrets.add(trimmed);
}

/** Registers the full URL and every path segment of the gateway manifest URL, plus decoded forms. */
export function registerSecretUrl(url: string | null | undefined): void {
  const trimmed = url?.trim();
  if (!trimmed) return;
  registerSecret(trimmed);
  try {
    const parsed = new URL(trimmed);
    for (const segment of parsed.pathname.split('/')) {
      if (!segment || /^(stremio|manifest\.json)$/i.test(segment)) continue;
      registerSecret(segment);
      try {
        registerSecret(decodeURIComponent(segment));
      } catch {
        // malformed percent-encoding: the raw segment is already registered
      }
    }
    for (const [, value] of parsed.searchParams) registerSecret(value);
  } catch {
    // not a parseable URL: the literal value is still registered
  }
}

export function clearSecrets(): void {
  secrets.clear();
}

export function redact(input: string): string {
  let out = input;
  const ordered = [...secrets].sort((a, b) => b.length - a.length);
  for (const secret of ordered) {
    out = out.split(secret).join(REDACTED);
    const encoded = encodeURIComponent(secret);
    if (encoded !== secret) out = out.split(encoded).join(REDACTED);
  }
  out = out.replace(ADDON_PATH, `$1${REDACTED}/`);
  out = out.replace(CDN_URL, `$1/${REDACTED}`);
  out = out.replace(SECRET_PARAM, `$1$2=${REDACTED}`);
  out = out.replace(BEARER, `$1 ${REDACTED}`);
  out = out.replace(JWT, REDACTED);
  return out;
}

export function redactDeep<T>(value: T): T {
  return walk(value, new WeakSet()) as T;
}

function walk(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === 'string') return redact(value);
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => walk(item, seen));
  if (value instanceof Error) {
    return { name: value.name, message: redact(value.message), stack: value.stack ? redact(value.stack) : undefined };
  }
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) result[key] = walk(item, seen);
  return result;
}

/** The only form in which the gateway URL may be shown to a user. */
export function displayGatewayUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return `https://${new URL(url).host}/stremio/${REDACTED}/manifest.json`;
  } catch {
    return `https://${REDACTED}/stremio/${REDACTED}/manifest.json`;
  }
}
