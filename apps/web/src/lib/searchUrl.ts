export const SEARCH_PATH = '/search';
/** Pause in the typing after which the results update. */
export const SEARCH_DELAY_MS = 300;
export const MIN_QUERY_CHARS = 2;
export const MAX_QUERY_LENGTH = 200;

const NAV_SEARCH_ATTRIBUTE = 'data-nav-search';

/** The text of `?q=` exactly as it was typed (spaces included). */
export function readSearchText(search: string): string {
  return new URLSearchParams(search).get('q') ?? '';
}

export function searchUrl(text: string): string {
  return text === '' ? SEARCH_PATH : `${SEARCH_PATH}?q=${encodeURIComponent(text)}`;
}

/** Navigation state that asks the Search page to run the search for `text` without waiting for a pause (Enter). */
export function searchNowState(text: string): { now: string } {
  return { now: text };
}

export function isSearchNow(state: unknown, text: string): boolean {
  return typeof state === 'object' && state !== null && 'now' in state && state.now === text;
}

/** Attribute that marks the nav search field, for the desktop app keys. */
export const NAV_SEARCH_PROPS = { [NAV_SEARCH_ATTRIBUTE]: '' } as const;

/** Moves the keyboard focus into the nav search field and selects its text. Returns false when it is not on the page. */
export function focusNavSearch(): boolean {
  const field = document.querySelector<HTMLInputElement>(`input[${NAV_SEARCH_ATTRIBUTE}]`);
  if (!field) return false;
  field.focus();
  field.select();
  return true;
}
