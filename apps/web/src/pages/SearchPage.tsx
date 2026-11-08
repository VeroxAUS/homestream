import type { MediaSummary } from '@homestream/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useLocation, useNavigationType } from 'react-router';
import { searchQuery } from '../api/queries';
import { ErrorPanel } from '../components/ErrorPanel';
import { Icon } from '../components/Icon';
import { PosterCard } from '../components/PosterCard';
import { MIN_QUERY_CHARS, SEARCH_DELAY_MS, isSearchNow, readSearchText } from '../lib/searchUrl';
import { useContentShown } from '../lib/useContentShown';
import { useDebouncedValue } from '../lib/useDebouncedValue';
import styles from './SearchPage.module.css';

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'movie', label: 'Movies' },
  { id: 'tv', label: 'Shows' },
] as const;
type Filter = (typeof FILTERS)[number]['id'];

function countText(count: number, text: string): string {
  return `${count} ${count === 1 ? 'result' : 'results'} for “${text}”`;
}

function Results({ text, results }: { text: string; results: readonly MediaSummary[] }) {
  const [filter, setFilter] = useState<Filter>('all');
  const shown = filter === 'all' ? results : results.filter((item) => item.type === filter);
  return (
    <section aria-label="Search results">
      <div className={styles.toolbar}>
        <h2 className={styles.count} aria-live="polite">
          {countText(shown.length, text)}
        </h2>
        <div className={styles.pills} role="group" aria-label="Filter results">
          {FILTERS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={`${styles.pill} ${filter === entry.id ? styles.pillActive : ''}`}
              aria-pressed={filter === entry.id}
              onClick={() => setFilter(entry.id)}
            >
              {entry.label}
            </button>
          ))}
        </div>
      </div>
      {shown.length === 0 ? (
        <Message text={`No ${filter === 'movie' ? 'movies' : 'shows'} for “${text}”`} hint="Try the All filter." />
      ) : (
        <ul className={styles.grid}>
          {shown.map((item) => (
            <li key={`${item.type}:${item.tmdbId}`}>
              <PosterCard item={item} showType />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Message({ text, hint }: { text: string; hint: string }) {
  return (
    <div className={styles.message}>
      <Icon name="search" size={40} className={styles.messageIcon} />
      <p className={styles.messageTitle}>{text}</p>
      <p className={styles.messageHint}>{hint}</p>
    </div>
  );
}

/**
 * The results for the `q` of the address; the field that sets it is in the nav. A deep link, Back or Forward searches at
 * once. Typing waits for a pause, counted from the page opening when the first key is what opened it. Enter searches
 * at once. Only the answer for the current text is shown.
 */
export default function SearchPage() {
  const { search, state } = useLocation();
  const opening = useNavigationType();
  const trimmed = readSearchText(search).trim();
  const paused = useDebouncedValue(trimmed, SEARCH_DELAY_MS, opening === 'POP' ? trimmed : '');
  const settled = isSearchNow(state, trimmed) ? trimmed : paused;
  const { data, error, refetch } = useQuery({
    ...searchQuery(settled),
    enabled: settled.length >= MIN_QUERY_CHARS,
  });
  useContentShown();

  const searching = (
    <p className={styles.searching} role="status">
      Searching...
    </p>
  );

  let body;
  if (trimmed.length < MIN_QUERY_CHARS) {
    body = <Message text="Search for movies and shows" hint="Type a title to find it." />;
  } else if (trimmed !== settled) {
    body = searching;
  } else if (error) {
    body = <ErrorPanel error={error} title="Search failed" onRetry={() => void refetch()} />;
  } else if (data) {
    body =
      data.results.length === 0 ? (
        <Message text={`No results for “${settled}”`} hint="Check the spelling or try a different title." />
      ) : (
        <Results key={settled} text={settled} results={data.results} />
      );
  } else {
    body = searching;
  }

  return (
    <main className={styles.page}>
      <h1 className="visually-hidden">Search</h1>
      {body}
    </main>
  );
}
