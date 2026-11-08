import { useSyncExternalStore } from 'react';

export const HIDE_SPOILERS_KEY = 'homestream.hideSpoilers';

/** Shown in place of the description of an episode that is not finished. */
export const SPOILER_TEXT = "Hidden to avoid spoilers. It appears once you've watched this episode.";

const listeners = new Set<() => void>();
// Only read when the browser blocks storage: the choice then lasts until the page closes.
let pageChoice: boolean | undefined;

function readSetting(): boolean {
  try {
    return window.localStorage.getItem(HIDE_SPOILERS_KEY) !== 'off';
  } catch {
    return pageChoice ?? true;
  }
}

function notify(): void {
  for (const listener of listeners) listener();
}

/** Turns spoiler hiding on or off for this device. Only `'off'` is stored; absent means on. */
export function setHideSpoilers(hide: boolean): void {
  pageChoice = hide;
  try {
    if (hide) window.localStorage.removeItem(HIDE_SPOILERS_KEY);
    else window.localStorage.setItem(HIDE_SPOILERS_KEY, 'off');
  } catch {
    // blocked storage: pageChoice carries the value
  }
  notify();
}

function subscribe(listener: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === HIDE_SPOILERS_KEY || event.key === null) listener();
  };
  listeners.add(listener);
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

/** True while this device hides the stills and descriptions of unfinished episodes (the default). */
export function useHideSpoilers(): boolean {
  return useSyncExternalStore(subscribe, readSetting);
}

/** An episode is shown in full only once it is finished: in-progress, untouched and not-yet-loaded all stay hidden. */
export function isEpisodeHidden(hideSpoilers: boolean, progress: { completed: boolean } | null | undefined): boolean {
  return hideSpoilers && progress?.completed !== true;
}
