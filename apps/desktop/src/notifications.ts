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

/** Native toast button, in the order of `ToastSpec.actions` (Electron reports a pressed button by that index). */
export interface ToastButton {
  type: 'button';
  text: string;
}

export function toastButtons(spec: ToastSpec): ToastButton[] {
  return spec.actions.map((action) => ({ type: 'button', text: action.label }));
}

/** What the user did to a shown toast, as Electron reports it. */
export type ToastInteraction = { kind: 'body' } | { kind: 'button'; index: number };

/**
 * The action the shell must run, or `null` when nothing may happen (Dismiss, "Got it", an unknown button).
 * Every toast control is a plain foreground button or the body, so Windows reports a Dismiss press as a
 * normal activation; only this decision keeps it from showing the window.
 */
export function toastActionFor(spec: ToastSpec, interaction: ToastInteraction): 'open' | 'health' | null {
  const action = interaction.kind === 'body' ? spec.actions[0] : spec.actions[interaction.index];
  return action && action.id !== 'dismiss' ? action.id : null;
}
