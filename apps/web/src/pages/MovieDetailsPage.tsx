import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { movieProgressQuery, movieQuery } from '../api/queries';
import { DetailsError } from '../components/DetailsError';
import { DetailsExtras } from '../components/DetailsExtras';
import { DetailsHero, GenreChips, MetaLine } from '../components/DetailsHero';
import { DetailsSkeleton } from '../components/DetailsSkeleton';
import { NotFound } from '../components/NotFound';
import { PlayActions } from '../components/PlayActions';
import { downloadKey } from '../events/downloadProgress';
import { usePendingDownload } from '../events/usePendingDownload';
import { formatRuntime } from '../lib/format';
import { useContentShown } from '../lib/useContentShown';
import { useTmdbId } from '../lib/useTmdbId';
import { prefetchTitle } from '../player/sessionApi';
import styles from './Details.module.css';

function MovieDetails({ tmdbId }: { tmdbId: number }) {
  const movie = useQuery(movieQuery(tmdbId));
  const progress = useQuery(movieProgressQuery(tmdbId));
  const download = usePendingDownload(downloadKey('movie', tmdbId), movie.data?.download);
  useContentShown(!movie.isPending);
  useEffect(() => prefetchTitle({ mediaType: 'movie', tmdbId }), [tmdbId]);

  if (movie.isPending) return <DetailsSkeleton />;
  if (movie.isError) return <DetailsError error={movie.error} noun="Movie" onRetry={() => void movie.refetch()} />;

  const { data } = movie;
  return (
    <main>
      <DetailsHero title={data.title} backdropUrl={data.backdropUrl} posterUrl={data.posterUrl}>
        <MetaLine rating={data.rating} year={data.year} extra={data.runtime ? formatRuntime(data.runtime) : null} />
        <GenreChips genres={data.genres} />
        {data.overview ? <p className={styles.overview}>{data.overview}</p> : null}
        <div className={styles.actions}>
          <PlayActions
            playPath={`/play/movie/${tmdbId}`}
            progress={progress.isError ? null : progress.data}
            download={download}
            subject={data.title}
          />
        </div>
      </DetailsHero>
      <DetailsExtras cast={data.cast} similar={data.similar} />
    </main>
  );
}

export default function MovieDetailsPage() {
  const tmdbId = useTmdbId();
  if (tmdbId === null) return <NotFound title="Movie not found" message="This is not a valid movie address." />;
  return <MovieDetails tmdbId={tmdbId} key={tmdbId} />;
}
