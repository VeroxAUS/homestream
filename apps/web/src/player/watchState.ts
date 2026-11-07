import type { QueryClient } from '@tanstack/react-query';

/**
 * Playing changes what Home (Continue Watching, Up next) and the details pages (Resume, Watched) show. Their cached
 * answers are older than the final progress ping, so mark them stale: the next visit, or the page already on screen,
 * reads the saved state again.
 */
export function invalidateWatchState(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: ['home'] });
  void queryClient.invalidateQueries({ queryKey: ['progress'] });
}
