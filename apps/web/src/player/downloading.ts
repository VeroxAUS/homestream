import type { Download, MovieDetailsWithDownload, ShowDetailsWithDownloads } from '@homestream/shared';
import type { QueryClient } from '@tanstack/react-query';
import type { PlayTarget } from './target';

/**
 * A 202 answer means TorBox is caching the title. Writing the download into the cached details response makes the
 * details page show its download badge at once ("Downloading", or the unconfirmed wording for a `pending` download),
 * and the refetch confirms it.
 */
export function markDownloading(queryClient: QueryClient, target: PlayTarget, download: Download): void {
  if (target.mediaType === 'movie') {
    queryClient.setQueryData<MovieDetailsWithDownload>(['movie', target.tmdbId], (old) =>
      old ? { ...old, download } : old,
    );
  } else {
    queryClient.setQueryData<ShowDetailsWithDownloads>(['show', target.tmdbId], (old) => {
      if (!old) return old;
      const others = (old.downloads ?? []).filter(
        (entry) => entry.season !== target.season || entry.episode !== target.episode,
      );
      return { ...old, downloads: [...others, download] };
    });
  }
  void queryClient.invalidateQueries({ queryKey: [target.mediaType === 'movie' ? 'movie' : 'show', target.tmdbId] });
}
