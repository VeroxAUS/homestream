import type { DesktopSettings, DownloadEvent, DownloadFailedEvent } from '@homestream/shared';

type ToastKind = 'ready' | 'failure' | 'closeNotice';

interface ToastAction {
  /** What the shell does when this button (or the toast body, for the first button) is activated. */
  id: 'open' | 'health' | 'dismiss';
  label: string;
}

export interface ToastSpec {
  kind: ToastKind;
  title: string;
  body: string;
  actions: ToastAction[];
  /** Window route the primary action opens. */
  route?: string;
  /** One toast per key; showing the same key again replaces the earlier one. */
  tag: string;
}

export interface NotifyContext {
  settings: DesktopSettings;
  /** The main or the mini window has the keyboard focus. */
  windowFocused: boolean;
}

const MAX_TITLE = 80;

/** A title as it may appear in a toast: plain text only, no control characters, shortened. */
export function toastTitleText(title: string): string {
  const clean = title
    .replace(/\p{Cc}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return clean.length > MAX_TITLE ? `${clean.slice(0, MAX_TITLE - 1)}\u2026` : clean;
}

/** The details page of a title (the same routes the web UI uses); an episode opens its show with the episode selected. */
export function detailsRoute(event: Pick<DownloadEvent, 'mediaType' | 'tmdbId' | 'season' | 'episode'>): string {
  if (event.mediaType === 'movie') return `/movie/${event.tmdbId}`;
  const episode =
    event.season !== undefined && event.episode !== undefined ? `?season=${event.season}&episode=${event.episode}` : '';
  return `/tv/${event.tmdbId}${episode}`;
}

/** The route of a media key (`movie:603`, `tv:1396:1:2`), or `null` for anything else. */
export function routeForMediaKey(mediaKey: string): string | null {
  const movie = /^movie:(\d{1,9})$/.exec(mediaKey);
  if (movie) return `/movie/${movie[1]}`;
  const tv = /^tv:(\d{1,9}):(\d{1,4}):(\d{1,4})$/.exec(mediaKey);
  return tv ? `/tv/${tv[1]}?season=${tv[2]}&episode=${tv[3]}` : null;
}

/** Download finished: always shown while the switch is on, focused window or not. */
export function planReadyToast(event: DownloadEvent, context: NotifyContext): ToastSpec | null {
  if (!context.settings.notifyReady) return null;
  return {
    kind: 'ready',
    title: `Ready to watch: ${toastTitleText(event.title)}`,
    body: 'TorBox finished downloading it. Click to open it in HomeStream.',
    actions: [
      { id: 'open', label: 'Play' },
      { id: 'dismiss', label: 'Dismiss' },
    ],
    route: detailsRoute(event),
    tag: `ready:${event.downloadId}`,
  };
}

function failureToast(title: string, body: string, tag: string, context: NotifyContext): ToastSpec | null {
  if (!context.settings.notifyFailures || context.windowFocused) return null;
  return {
    kind: 'failure',
    title,
    body,
    actions: [
      { id: 'health', label: 'Open Health' },
      { id: 'dismiss', label: 'Dismiss' },
    ],
    route: '/dashboard/health',
    tag,
  };
}

export function planSessionFailureToast(
  session: { sessionId: string; title: string },
  context: NotifyContext,
): ToastSpec | null {
  return failureToast(
    `Couldn't play ${toastTitleText(session.title)}`,
    'Open Health to see why.',
    `session:${session.sessionId}`,
    context,
  );
}

export function planDownloadFailureToast(event: DownloadFailedEvent, context: NotifyContext): ToastSpec | null {
  return failureToast(
    `TorBox couldn't download ${toastTitleText(event.title)}`,
    'Open Health to see why.',
    `download:${event.downloadId}`,
    context,
  );
}

/** Shown the first time the window is closed to the tray, and never again. */
export function planCloseNotice(settings: DesktopSettings): ToastSpec | null {
  if (settings.closeNoticeShown) return null;
  return {
    kind: 'closeNotice',
    title: 'HomeStream is still running',
    body: 'Your TV and other devices can keep watching. To quit, right-click the HomeStream icon in the tray.',
    actions: [{ id: 'dismiss', label: 'Got it' }],
    tag: 'close-notice',
  };
}

function escapeXml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

/** Arguments are fixed words, never data from the server. */
const ARGUMENTS: Record<ToastAction['id'], string> = { open: 'hs-open', health: 'hs-health', dismiss: 'hs-dismiss' };

/**
 * Windows toast XML with real buttons. Only the title text and fixed words go in: no URL, file name or key.
 * Dismiss uses the system activation, so it just closes the toast.
 */
export function toastXml(spec: ToastSpec): string {
  const [primary] = spec.actions;
  const launch = primary && primary.id !== 'dismiss' ? ARGUMENTS[primary.id] : ARGUMENTS.dismiss;
  const actions = spec.actions
    .map((action) => {
      const activation = action.id === 'dismiss' ? 'system' : 'foreground';
      const args = action.id === 'dismiss' ? 'dismiss' : ARGUMENTS[action.id];
      return `<action content="${escapeXml(action.label)}" arguments="${args}" activationType="${activation}"/>`;
    })
    .join('');
  return (
    `<toast launch="${launch}" activationType="foreground">` +
    `<visual><binding template="ToastGeneric"><text>${escapeXml(spec.title)}</text><text>${escapeXml(spec.body)}</text></binding></visual>` +
    `<actions>${actions}</actions></toast>`
  );
}
