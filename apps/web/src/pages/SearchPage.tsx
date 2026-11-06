import type { MediaSummary } from '@homestream/shared';
import { useQuery } from '@tanstack/react-query';
import { useState, type KeyboardEvent } from 'react';
import { useSearchParams } from 'react-router';
import { searchQuery } from '../api/queries';
import { ErrorPanel } from '../components/ErrorPanel';
import { Icon } from '../components/Icon';
import { PosterCard } from '../components/PosterCard';
import { useContentShown } from '../lib/useContentShown';
import { useDebouncedValue } from '../lib/useDebouncedValue';
import styles from './SearchPage.module.css';

const SEARCH_DELAY_MS = 300;
const MAX_QUERY_LENGTH = 200;

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

export default function SearchPage() {
  const [params, setParams] = useSearchParams();
  const [typed, setTyped] = useState(params.get('q') ?? '');
  const trimmed = typed.trim();
  const text = useDebouncedValue(trimmed, SEARCH_DELAY_MS);
  const { data, error, refetch } = useQuery({ ...searchQuery(text), enabled: text !== '' });
  useContentShown();

  const searching = (
    <p className={styles.searching} role="status">
      Searching...
    </p>
  );
  const change = (value: string) => {
    setTyped(value);
    setParams(value.trim() ? { q: value.trim() } : {}, { replace: true });
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') change('');
  };

  let body;
  if (trimmed === '') {
    body = <Message text="Search for movies and shows" hint="Type a title to find it." />;
  } else if (trimmed !== text) {
    body = searching;
  } else if (error) {
    body = <ErrorPanel error={error} title="Search failed" onRetry={() => void refetch()} />;
  } else if (data) {
    body =
      data.results.length === 0 ? (
        <Message text={`No results for “${text}”`} hint="Check the spelling or try a different title." />
      ) : (
        <Results key={text} text={text} results={data.results} />
      );
  } else {
    body = searching;
  }

  return (
    <main className={styles.page}>
      <h1 className="visually-hidden">Search</h1>
      <div className={styles.box}>
        <Icon name="search" size={22} className={styles.boxIcon} />
        <input
          className={styles.input}
          type="text"
          value={typed}
          maxLength={MAX_QUERY_LENGTH}
          placeholder="Search movies and shows"
          aria-label="Search movies and shows"
          autoComplete="off"
          autoFocus
          onChange={(event) => change(event.target.value)}
          onKeyDown={onKeyDown}
        />
        {typed ? <span className={styles.hintKey}>Esc to clear</span> : null}
      </div>
      {body}
    </main>
  );
}
