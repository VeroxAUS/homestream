import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { MAX_QUERY_LENGTH, NAV_SEARCH_PROPS } from '../lib/searchUrl';
import { useMediaQuery } from '../lib/useMediaQuery';
import { loadSearchPage } from '../pages/searchRoute';
import { Icon } from './Icon';
import { useNavSearch } from './useNavSearch';
import styles from './NavSearch.module.css';

const PHONE_QUERY = '(max-width: 699px)';
const LABEL = 'Search movies and shows';

/** The search field in the middle of the nav; on a phone an icon button that opens the field over the nav. */
export function NavSearch() {
  const phone = useMediaQuery(PHONE_QUERY);
  const search = useNavSearch();
  const [expanded, setExpanded] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const { onSearchPage, value } = search;

  useEffect(() => {
    if (!onSearchPage) setExpanded(false);
  }, [onSearchPage]);

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      search.submit();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      search.clear();
      setExpanded(false);
    }
  };

  const clear = () => {
    search.clear();
    input.current?.focus();
  };

  return (
    <div className={phone ? styles.phoneSlot : styles.slot}>
      {phone ? (
        <button
          type="button"
          className={styles.iconButton}
          aria-label="Search"
          aria-expanded={expanded}
          tabIndex={expanded ? -1 : undefined}
          onClick={() => {
            void loadSearchPage();
            setExpanded(true);
          }}
        >
          <Icon name="search" size={20} />
        </button>
      ) : null}
      {!phone || expanded ? (
        <div className={`${styles.field} ${phone ? styles.overlay : ''}`}>
          <Icon name="search" size={18} className={styles.icon} />
          <input
            {...NAV_SEARCH_PROPS}
            ref={input}
            className={styles.input}
            type="text"
            value={value}
            maxLength={MAX_QUERY_LENGTH}
            placeholder={LABEL}
            aria-label={LABEL}
            autoComplete="off"
            spellCheck={false}
            enterKeyHint="search"
            autoFocus={phone}
            onChange={(event) => search.change(event.target.value)}
            onFocus={() => void loadSearchPage()}
            onBlur={() => {
              if (phone && value === '') setExpanded(false);
            }}
            onKeyDown={onKeyDown}
          />
          {value === '' ? null : (
            <button
              type="button"
              className={styles.clear}
              aria-label="Clear search"
              onMouseDown={(event) => event.preventDefault()}
              onClick={clear}
            >
              <Icon name="close" size={14} />
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}
