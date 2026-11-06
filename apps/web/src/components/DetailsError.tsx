import { ApiError } from '../api/client';
import { useContentShown } from '../lib/useContentShown';
import { ErrorPanel } from './ErrorPanel';
import { NotFound } from './NotFound';

interface DetailsErrorProps {
  error: unknown;
  /** "Movie" or "Show". */
  noun: string;
  onRetry: () => void;
}

/** A title the server does not know is "not found"; every other failure explains itself and offers a retry. */
export function DetailsError({ error, noun, onRetry }: DetailsErrorProps) {
  useContentShown();
  if (error instanceof ApiError && error.status === 404) {
    return <NotFound title={`${noun} not found`} message={`${error.message} It may have been removed from TMDB.`} />;
  }
  return (
    <main>
      <ErrorPanel error={error} onRetry={onRetry} />
    </main>
  );
}
