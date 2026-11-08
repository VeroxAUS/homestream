import type { CastMember, MediaSummary } from '@homestream/shared';
import { CastRow } from './CastRow';
import { PosterRow } from './PosterRow';
import styles from './DetailsExtras.module.css';

interface DetailsExtrasProps {
  cast: readonly CastMember[];
  similar: readonly MediaSummary[];
}

/** The Cast and "More like this" rows under a details page; a row with nothing to show is left out entirely. */
export function DetailsExtras({ cast, similar }: DetailsExtrasProps) {
  if (cast.length === 0 && similar.length === 0) return null;
  return (
    <div className={styles.extras}>
      {cast.length > 0 ? <CastRow cast={cast} /> : null}
      {similar.length > 0 ? <PosterRow title="More like this" items={similar} belowFold /> : null}
    </div>
  );
}
