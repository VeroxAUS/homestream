import type { EpisodeProgress, Season, ShowDetailsWithDownloads, ShowProgressResponse } from '@homestream/shared';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { seasonQuery, showProgressQuery, showQuery } from '../api/queries';
import { DetailsError } from '../components/DetailsError';
import { DetailsHero, GenreChips, MetaLine } from '../components/DetailsHero';
import { DetailsSkeleton } from '../components/DetailsSkeleton';
import { EpisodePanel } from '../components/EpisodePanel';
import { EpisodeRow } from '../components/EpisodeRow';
import { ErrorPanel } from '../components/ErrorPanel';
import { NotFound } from '../components/NotFound';
import { orderSeasons, pickSeason, seasonLabel } from '../lib/seasons';
import { useContentShown } from '../lib/useContentShown';
import { useTmdbId } from '../lib/useTmdbId';
import { prefetchTitle } from '../player/sessionApi';
import styles from './Details.module.css';

/** Seasons with hundreds of episodes show them in pages, so the page never holds more than a few hundred nodes. */
const EPISODES_PER_PAGE = 100;

type ProgressLookup = ReadonlyMap<string, EpisodeProgress> | undefined;

interface SeasonBodyProps {
  tmdbId: number;
  show: ShowDetailsWithDownloads;
  season: Season;
  progress: ProgressLookup;
  selectedEpisode: number | null;
  onSelect: (episodeNumber: number) => void;
}

function SeasonBody({ tmdbId, show, season, progress, selectedEpisode, onSelect }: SeasonBodyProps) {
  const [limit, setLimit] = useState(EPISODES_PER_PAGE);
  const selected = season.episodes.find((entry) => entry.episodeNumber === selectedEpisode) ?? season.episodes[0];
  const progressOf = (episode: number): EpisodeProgress | undefined =>
    progress?.get(`${season.seasonNumber}:${episode}`);
  const visible = season.episodes.slice(0, limit);

  if (!selected) return <p className={styles.seasonStatus}>This season has no episodes yet.</p>;
  return (
    <div className={styles.columns}>
      <ul className={styles.list} aria-label={`${season.name} episodes`}>
        {visible.map((episode) => (
          <EpisodeRow
            key={episode.episodeNumber}
            tmdbId={tmdbId}
            season={season.seasonNumber}
            episode={episode}
            fallbackStill={show.backdropUrl}
            progress={progressOf(episode.episodeNumber)}
            selected={episode.episodeNumber === selected.episodeNumber}
            onSelect={onSelect}
          />
        ))}
        {season.episodes.length > limit ? (
          <li>
            <button type="button" className={styles.more} onClick={() => setLimit(limit + EPISODES_PER_PAGE)}>
              Show more episodes
            </button>
          </li>
        ) : null}
      </ul>
      <div className={styles.panelSlot}>
        <EpisodePanel
          tmdbId={tmdbId}
          season={season.seasonNumber}
          episode={selected}
          fallbackStill={show.backdropUrl}
          progress={progress === undefined ? undefined : (progressOf(selected.episodeNumber) ?? null)}
          download={show.downloads?.find(
            (entry) => entry.season === season.seasonNumber && entry.episode === selected.episodeNumber,
          )}
        />
      </div>
    </div>
  );
}

function useProgressLookup(progress: { data?: ShowProgressResponse; isError: boolean }): ProgressLookup {
  return useMemo<ProgressLookup>(() => {
    if (progress.isError) return new Map();
    if (!progress.data) return undefined;
    return new Map(progress.data.items.map((item) => [`${item.season}:${item.episode}`, item]));
  }, [progress.data, progress.isError]);
}

function ShowDetails({ tmdbId }: { tmdbId: number }) {
  const show = useQuery(showQuery(tmdbId));
  const progress = useQuery(showProgressQuery(tmdbId));
  const [params, setParams] = useSearchParams();
  const seasons = useMemo(() => (show.data ? orderSeasons(show.data.seasons) : []), [show.data]);
  const seasonNumber = pickSeason(params.get('season'), seasons);
  const season = useQuery({ ...seasonQuery(tmdbId, seasonNumber ?? 0), enabled: seasonNumber !== null });
  useContentShown(!show.isPending);

  const lookup = useProgressLookup(progress);

  const chooseSeason = useCallback(
    (next: number) => setParams({ season: String(next) }, { replace: true }),
    [setParams],
  );
  const chooseEpisode = useCallback(
    (episode: number) => {
      setParams({ season: String(seasonNumber), episode: String(episode) }, { replace: true });
      if (seasonNumber !== null) prefetchTitle({ mediaType: 'tv', tmdbId, season: seasonNumber, episode });
    },
    [setParams, seasonNumber, tmdbId],
  );

  if (show.isPending) return <DetailsSkeleton />;
  if (show.isError) return <DetailsError error={show.error} noun="Show" onRetry={() => void show.refetch()} />;

  const { data } = show;
  const requestedEpisode = Number(params.get('episode'));
  const regular = seasons.filter((entry) => entry.seasonNumber > 0).length;
  return (
    <main>
      <DetailsHero title={data.title} backdropUrl={data.backdropUrl} posterUrl={data.posterUrl}>
        <MetaLine
          rating={data.rating}
          year={data.year}
          extra={regular > 0 ? `${regular} ${regular === 1 ? 'season' : 'seasons'}` : null}
        />
        <GenreChips genres={data.genres} />
        {data.overview ? <p className={styles.overview}>{data.overview}</p> : null}
      </DetailsHero>
      {seasons.length === 0 ? <p className={styles.seasonStatus}>No episodes are listed for this show yet.</p> : null}
      {seasons.length > 0 ? (
        <div className={styles.seasons} role="tablist" aria-label="Seasons">
          {seasons.map((entry) => (
            <button
              key={entry.seasonNumber}
              type="button"
              role="tab"
              className={`${styles.season} ${entry.seasonNumber === seasonNumber ? styles.seasonActive : ''}`}
              aria-selected={entry.seasonNumber === seasonNumber}
              onClick={() => chooseSeason(entry.seasonNumber)}
            >
              {seasonLabel(entry)}
            </button>
          ))}
        </div>
      ) : null}
      <div role="tabpanel" aria-label={seasonNumber === null ? 'Episodes' : `Season ${seasonNumber} episodes`}>
        {season.isPending && seasonNumber !== null ? (
          <p className={`${styles.seasonStatus} pulse`} role="status">
            Loading episodes...
          </p>
        ) : null}
        {season.isError ? (
          <ErrorPanel error={season.error} title="Episodes could not be loaded" onRetry={() => void season.refetch()} />
        ) : null}
        {season.data ? (
          <SeasonBody
            key={season.data.seasonNumber}
            tmdbId={tmdbId}
            show={data}
            season={season.data}
            progress={lookup}
            selectedEpisode={Number.isInteger(requestedEpisode) && requestedEpisode > 0 ? requestedEpisode : null}
            onSelect={chooseEpisode}
          />
        ) : null}
      </div>
    </main>
  );
}

export default function ShowDetailsPage() {
  const tmdbId = useTmdbId();
  if (tmdbId === null) return <NotFound title="Show not found" message="This is not a valid show address." />;
  return <ShowDetails tmdbId={tmdbId} key={tmdbId} />;
}
