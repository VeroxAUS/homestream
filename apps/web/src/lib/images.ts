export type TmdbSize = 'w92' | 'w185' | 'w300' | 'w342' | 'w500' | 'w780' | 'w1280';

const SIZE_SEGMENT = /\/t\/p\/[^/]+\//;

/**
 * The same TMDB image at another size. Each place on screen asks for the smallest size that still looks sharp, so a
 * URL that holds no size segment (a test stub, a missing image) is returned unchanged.
 */
export function tmdbImage(url: string | null | undefined, size: TmdbSize): string | null {
  if (!url) return null;
  return url.replace(SIZE_SEGMENT, `/t/p/${size}/`);
}
