import type { MediaSummary } from '@homestream/shared';
import { PosterCard } from './PosterCard';
import { RowItem, RowSection } from './RowSection';

interface PosterRowProps {
  title: string;
  items: readonly MediaSummary[];
  belowFold?: boolean;
}

export function PosterRow({ title, items, belowFold = false }: PosterRowProps) {
  return (
    <RowSection title={title} belowFold={belowFold}>
      {items.map((item) => (
        <RowItem key={`${item.type}:${item.tmdbId}`}>
          <PosterCard item={item} />
        </RowItem>
      ))}
    </RowSection>
  );
}
