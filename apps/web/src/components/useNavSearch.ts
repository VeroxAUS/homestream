import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { MIN_QUERY_CHARS, SEARCH_PATH, readSearchText, searchNowState, searchUrl } from '../lib/searchUrl';

export interface NavSearchModel {
  value: string;
  /** True while the address is the Search page. */
  onSearchPage: boolean;
  change: (next: string) => void;
  /** Runs the search for what is typed at once, without waiting for a pause. */
  submit: () => void;
  clear: () => void;
}

/**
 * The text of the nav search field and its link to the address: typing opens `/search?q=` (one history entry, every
 * later key replaces it), the field shows `q` on the Search page and is empty everywhere else.
 */
export function useNavSearch(): NavSearchModel {
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  const onSearchPage = pathname === SEARCH_PATH;
  const urlText = onSearchPage ? readSearchText(search) : '';
  const [value, setValue] = useState(urlText);
  // Where the address is, as far as this hook knows: it is updated at once when it navigates, because the router can
  // commit a navigation after the next key was typed.
  const at = useRef({ onSearchPage, text: urlText });
  // Texts this hook navigated to that the address has not shown yet. An address change that is not one of them came
  // from outside (Back, Forward, a link) and the field follows it; one of them must not overwrite newer typing.
  const sent = useRef<string[]>([]);

  useEffect(() => {
    at.current = { onSearchPage, text: urlText };
    if (!onSearchPage) {
      sent.current = [];
      setValue('');
      return;
    }
    const index = sent.current.indexOf(urlText);
    if (index >= 0) {
      sent.current.splice(0, index + 1);
      return;
    }
    sent.current = [];
    setValue(urlText);
  }, [onSearchPage, urlText]);

  const go = useCallback(
    (text: string, now?: string) => {
      const here = at.current;
      if (!here.onSearchPage || here.text !== text) sent.current.push(text);
      navigate(searchUrl(text), { replace: here.onSearchPage, state: now === undefined ? null : searchNowState(now) });
      at.current = { onSearchPage: true, text };
    },
    [navigate],
  );

  const change = useCallback(
    (next: string) => {
      setValue(next);
      if (next !== '' || at.current.onSearchPage) go(next);
    },
    [go],
  );

  const submit = useCallback(() => {
    const text = value.trim();
    if (text.length >= MIN_QUERY_CHARS) go(value, text);
  }, [go, value]);

  const clear = useCallback(() => change(''), [change]);

  return { value, onSearchPage, change, submit, clear };
}
