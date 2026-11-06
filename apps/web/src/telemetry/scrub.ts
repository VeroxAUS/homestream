import { SCRUBBED, sanitizeBreadcrumb, sanitizeSentryEvent, sanitizeText } from '@homestream/shared';

const URL_IN_TEXT = /\b(?:https?|wss?):\/\/[^\s"'<>]+/gi;

/** http://host:8600/assets/index-1.js?x=1 becomes pp:///assets/index-1.js: the origin may be a LAN address. */
function appPath(location: string): string {
  if (!/^(?:https?|wss?):\/\//i.test(location)) return location;
  try {
    return `app://${new URL(location).pathname}`;
  } catch {
    return SCRUBBED;
  }
}

/**
 * What is left of a URL for a breadcrumb: the path, without origin, query string and fragment. The shared sanitizer then
 * removes CDN hosts and `/stremio/<segment>` paths. (It would replace a complete URL, which makes the path unreadable.)
 */
export function scrubUrl(url: string): string {
  const withoutOrigin = url.replace(URL_IN_TEXT, appPath);
  return sanitizeText(
    withoutOrigin.startsWith('/') ? (withoutOrigin.split(/[?#]/)[0] ?? withoutOrigin) : withoutOrigin,
  );
}

interface UrlData {
  url?: unknown;
  from?: unknown;
  to?: unknown;
}

/**
 * Keeps breadcrumbs useful (what was requested, where the user navigated) without origins, query strings or secrets. URLs
 * are reduced to paths before the shared sanitizer runs, because it replaces a complete URL.
 */
export function scrubBreadcrumb<T extends { data?: object; message?: string }>(breadcrumb: T): T {
  const data = breadcrumb.data ? ({ ...breadcrumb.data } as UrlData) : undefined;
  if (data) {
    for (const key of ['url', 'from', 'to'] as const) {
      const value = data[key];
      if (typeof value === 'string') data[key] = scrubUrl(value);
    }
  }
  const message = typeof breadcrumb.message === 'string' ? scrubUrl(breadcrumb.message) : undefined;
  return sanitizeBreadcrumb({
    ...breadcrumb,
    ...(data ? { data } : {}),
    ...(message === undefined ? {} : { message }),
  });
}
interface Located {
  filename?: string;
  abs_path?: string;
  code_file?: string;
}
interface FrameEvent {
  exception?: { values?: Array<{ stacktrace?: { frames?: Located[] } }> };
  debug_meta?: { images?: Located[] };
}

function relocateFiles(event: FrameEvent): void {
  const located = [
    ...(event.exception?.values ?? []).flatMap((value) => value.stacktrace?.frames ?? []),
    ...(event.debug_meta?.images ?? []),
  ];
  for (const item of located) {
    for (const key of ['filename', 'abs_path', 'code_file'] as const) {
      const value = item[key];
      if (typeof value === 'string') item[key] = appPath(value);
    }
  }
}

/**
 * An error event with no user, request, cookies or server name, text scrubbed, ingestion told not to infer IP or geo.
 * Script locations lose their origin first (the shared sanitizer would otherwise replace the whole URL, and with it the
 * file name that stack traces are matched on).
 */
export function scrubEvent<T extends object>(event: T): T {
  relocateFiles(event as FrameEvent);
  return sanitizeSentryEvent(event);
}
