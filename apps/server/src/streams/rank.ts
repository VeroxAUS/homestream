import type { CapabilityProfile, StreamOption, StreamResolution } from '@homestream/shared';

export const RESOLUTION_RANK: Record<StreamResolution, number> = {
  '2160p': 4,
  '1080p': 3,
  '720p': 2,
  '480p': 1,
  unknown: 0,
};

const SOURCE_RANK: Record<string, number> = {
  Remux: 5,
  BluRay: 4,
  'WEB-DL': 3,
  WEBRip: 2,
  HDTV: 1,
};

export function sourceRank(source: string): number {
  return SOURCE_RANK[source] ?? 0;
}

/**
 * Cached first, then resolution desc, then source quality desc; the gateway's own order breaks ties.
 * When at least one stream is cached the uncached ones are dropped.
 */
export function rankStreams(options: StreamOption[]): StreamOption[] {
  const anyCached = options.some((option) => option.cached);
  return options
    .map((option, index) => ({ option, index }))
    .filter(({ option }) => !anyCached || option.cached)
    .sort(
      (a, b) =>
        Number(b.option.cached) - Number(a.option.cached) ||
        RESOLUTION_RANK[b.option.resolution] - RESOLUTION_RANK[a.option.resolution] ||
        sourceRank(b.option.source) - sourceRank(a.option.source) ||
        a.index - b.index,
    )
    .map(({ option }) => option);
}

/** Highest resolution tier a device can show, from its reported maximum display size. */
export function deviceMaxRank(profile: Pick<CapabilityProfile, 'maxWidth' | 'maxHeight'>): number {
  const byHeight = profile.maxHeight >= 2160 ? 4 : profile.maxHeight >= 1080 ? 3 : profile.maxHeight >= 720 ? 2 : 1;
  const byWidth = profile.maxWidth >= 3840 ? 4 : profile.maxWidth >= 1920 ? 3 : profile.maxWidth >= 1280 ? 2 : 1;
  return Math.min(byHeight, byWidth);
}

/**
 * First ranked stream that fits the device. Streams of unknown resolution always fit.
 * If none fits, the first-ranked stream with the lowest resolution.
 */
export function recommendStream(ranked: StreamOption[], maxRank: number | null): StreamOption | null {
  if (ranked.length === 0) return null;
  if (maxRank === null) return ranked[0] as StreamOption;
  const fitting = ranked.find((option) => RESOLUTION_RANK[option.resolution] <= maxRank);
  if (fitting) return fitting;
  const lowest = Math.min(...ranked.map((option) => RESOLUTION_RANK[option.resolution]));
  return ranked.find((option) => RESOLUTION_RANK[option.resolution] === lowest) ?? (ranked[0] as StreamOption);
}
