import { useEffect, useRef } from 'react';
import { SKIP_BACK_SEC, SKIP_FORWARD_SEC, VOLUME_STEP, type PlayerActions } from './usePlayerActions';

export type Shortcut =
  | 'togglePlay'
  | 'skipBack'
  | 'skipForward'
  | 'volumeUp'
  | 'volumeDown'
  | 'mute'
  | 'fullscreen'
  | 'subtitles'
  | 'info'
  | 'miniPlayer'
  | 'escape';

const KEYS: Record<string, Shortcut> = {
  ' ': 'togglePlay',
  k: 'togglePlay',
  ArrowLeft: 'skipBack',
  ArrowRight: 'skipForward',
  ArrowUp: 'volumeUp',
  ArrowDown: 'volumeDown',
  m: 'mute',
  f: 'fullscreen',
  c: 'subtitles',
  i: 'info',
  p: 'miniPlayer',
  Escape: 'escape',
};

/** Holding these down must not fire them over and over. */
const NO_REPEAT: ReadonlySet<Shortcut> = new Set([
  'togglePlay',
  'mute',
  'fullscreen',
  'subtitles',
  'info',
  'miniPlayer',
  'escape',
]);

/** The shortcut a key press stands for, or `null`. Modified presses (Ctrl, Alt, Meta) belong to the app and the OS. */
export function shortcutFor(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'altKey' | 'metaKey'>): Shortcut | null {
  if (event.ctrlKey || event.altKey || event.metaKey) return null;
  return KEYS[event.key] ?? KEYS[event.key.toLowerCase()] ?? null;
}

export function typesText(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) {
    return true;
  }
  return target instanceof HTMLInputElement && target.type !== 'range' && target.type !== 'checkbox';
}

const ARROW_SHORTCUTS: ReadonlySet<Shortcut> = new Set(['skipBack', 'skipForward', 'volumeUp', 'volumeDown']);

/** A native range input steps itself with the arrows; the global seek and volume keys would fight it. */
function isRangeInput(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement && target.type === 'range';
}

interface ShortcutHandlers {
  actions: PlayerActions;
  toggleSubtitles: () => void;
  toggleInfo: () => void;
  /** Only in the desktop app; without it the P key is left alone. */
  miniPlayer?: (() => void) | null;
  escape: () => void;
}

/**
 * Player keys (Space/K, arrows, M, F, C, I, P, Esc). They work while the controls are hidden because they listen on the
 * document. Space is swallowed on key up as well, so a focused button is not also "clicked" by the same press.
 */
export function useShortcuts(handlers: ShortcutHandlers): void {
  const ref = useRef(handlers);
  ref.current = handlers;

  useEffect(() => {
    const run = (shortcut: Shortcut) => {
      const { actions, toggleSubtitles, toggleInfo, miniPlayer, escape } = ref.current;
      const table: Record<Shortcut, () => void> = {
        togglePlay: actions.togglePlay,
        skipBack: () => actions.skip(-SKIP_BACK_SEC),
        skipForward: () => actions.skip(SKIP_FORWARD_SEC),
        volumeUp: () => actions.changeVolume(VOLUME_STEP),
        volumeDown: () => actions.changeVolume(-VOLUME_STEP),
        mute: actions.toggleMute,
        fullscreen: actions.toggleFullscreen,
        subtitles: toggleSubtitles,
        info: toggleInfo,
        miniPlayer: () => miniPlayer?.(),
        escape,
      };
      table[shortcut]();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || typesText(event.target)) return;
      const shortcut = shortcutFor(event);
      if (!shortcut || (shortcut === 'miniPlayer' && !ref.current.miniPlayer)) return;
      if (ARROW_SHORTCUTS.has(shortcut) && isRangeInput(event.target)) return;
      event.preventDefault();
      if (event.repeat && NO_REPEAT.has(shortcut)) return;
      run(shortcut);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === ' ' && !typesText(event.target)) event.preventDefault();
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('keyup', onKeyUp);
    };
  }, []);
}
