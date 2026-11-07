import { useQuery } from '@tanstack/react-query';
import { movieQuery, seasonQuery, showQuery } from '../api/queries';
import { tmdbImage } from '../lib/images';
import { episodeCode, type PlayTarget } from './target';

export interface TitleMeta {
  /** `null` while the title is still loading; the player waits for it before it publishes Media Session data. */
  title: string | null;
  /** "1994" for a movie, "S1E1 · Pilot" for an episode. */
  line: string;
  posterUrl: string | null;
}

const MOVIE_FALLBACK: TitleMeta = { title: 'HomeStream', line: '', posterUrl: null };

/** The names around a playing title. They come from the details queries, which the details page already filled. */
export function useTitleMeta(target: PlayTarget): TitleMeta {
  const isMovie = target.mediaType === 'movie';
  const movie = useQuery({ ...movieQuery(target.tmdbId), enabled: isMovie });
  const show = useQuery({ ...showQuery(target.tmdbId), enabled: !isMovie });
  const season = useQuery({ ...seasonQuery(target.tmdbId, target.season ?? 0), enabled: !isMovie });

  if (isMovie) {
    if (movie.data) {
      return {
        title: movie.data.title,
        line: movie.data.year ? String(movie.data.year) : '',
        posterUrl: tmdbImage(movie.data.posterUrl, 'w342'),
      };
    }
    return movie.isError ? MOVIE_FALLBACK : { title: null, line: '', posterUrl: null };
  }
  if (!show.data) return show.isError ? MOVIE_FALLBACK : { title: null, line: '', posterUrl: null };
  const name = season.data?.episodes.find((entry) => entry.episodeNumber === target.episode)?.name;
  return {
    title: show.data.title,
    line: [episodeCode(target), name].filter(Boolean).join(' \u00b7 '),
    posterUrl: tmdbImage(show.data.posterUrl, 'w342'),
  };
}
