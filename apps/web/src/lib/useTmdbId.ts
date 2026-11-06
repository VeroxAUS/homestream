import { useParams } from 'react-router';

/** The `:id` of the route as a TMDB id, or `null` when it is not a positive whole number. */
export function useTmdbId(): number | null {
  const { id } = useParams();
  return id !== undefined && /^\d{1,10}$/.test(id) && Number(id) > 0 ? Number(id) : null;
}
