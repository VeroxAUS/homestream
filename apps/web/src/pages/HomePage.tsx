import type { HomeResponse } from '@homestream/shared';
import { useQuery } from '@tanstack/react-query';
import { homeQuery } from '../api/queries';
import { Banner } from '../components/Banner';
import { ContinueWatchingRow } from '../components/ContinueWatchingRow';
import { ErrorPanel } from '../components/ErrorPanel';
import { PosterRow } from '../components/PosterRow';
import { FinishSetup } from '../desktop/FinishSetup';
import { useMissingKeys } from '../desktop/useMissingKeys';
import { useContentShown } from '../lib/useContentShown';
import styles from './HomePage.module.css';

const SKELETON_CARDS = 8;

function HomeSkeleton() {
  return (
    <div className="pulse" role="status" aria-label="Loading Home">
      <div className={styles.skeletonBanner} />
      {[0, 1].map((row) => (
        <div key={row} className={styles.skeletonRow}>
          <div className={styles.skeletonHeading} />
          <div className={styles.skeletonCards}>
            {Array.from({ length: SKELETON_CARDS }, (_, card) => (
              <div key={card} className={styles.skeletonCard} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function HomeRows({ home }: { home: HomeResponse }) {
  return (
    <>
      {home.continueWatching.length > 0 ? <ContinueWatchingRow items={home.continueWatching} /> : null}
      <Banner items={home.featured} />
      <PosterRow title="Trending Movies" items={home.trendingMovies} />
      <PosterRow title="Trending Shows" items={home.trendingShows} belowFold />
      <PosterRow title="Popular Movies" items={home.popularMovies} belowFold />
      <PosterRow title="Popular Shows" items={home.popularShows} belowFold />
    </>
  );
}

export default function HomePage() {
  const { data, error, isPending, refetch } = useQuery(homeQuery());
  const missingKeys = useMissingKeys();
  useContentShown(!isPending || missingKeys !== null);

  if (missingKeys) return <FinishSetup keys={missingKeys} />;
  return (
    <main className={styles.page}>
      <h1 className="visually-hidden">Home</h1>
      {isPending ? <HomeSkeleton /> : null}
      {error && !data ? <ErrorPanel error={error} onRetry={() => void refetch()} /> : null}
      {data ? <HomeRows home={data} /> : null}
    </main>
  );
}
