import type { CapabilityProfile, StreamOption, StreamResolution } from '@homestream/shared';

export const RESOLUTION_RANK: Record<StreamResolution, number> = {
  '2160p': 5,
  '1440p': 4,
  '1080p': 3,
  '720p': 2,
  '480p': 1,
  unknown: 0,
};

/** Smaller sources first: a WEB-DL starts faster and downloads less than a Remux of the same resolution. */
const SOURCE_RANK: Record<string, number> = {
  'WEB-DL': 5,
  BluRay: 4,
  WEBRip: 3,
  Remux: 2,
  HDTV: 1,
};

export function sourceRank(source: string): number {
  return SOURCE_RANK[source] ?? 0;
}

/**
 * Cached first, then resolution desc, then source rank (WEB-DL, BluRay, WEBRip, Remux, HDTV); the gateway's own order breaks ties.
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

/** Rank (5 down to 1) of the first threshold the size reaches; thresholds are the 2160p, 1440p, 1080p and 720p minimums. */
function tier(size: number, thresholds: readonly number[]): number {
  const index = thresholds.findIndex((minimum) => size >= minimum);
  return index === -1 ? 1 : 5 - index;
}

/** Highest resolution tier a device can show, from its reported maximum display size. */
export function deviceMaxRank(profile: Pick<CapabilityProfile, 'maxWidth' | 'maxHeight'>): number {
  return Math.min(tier(profile.maxHeight, [2160, 1440, 1080, 720]), tier(profile.maxWidth, [3840, 2560, 1920, 1280]));
}

/**
 * Streams an automatic start may try, best first: the cached ones that fit the device (unknown resolution always fits).
 * When none fits, the first-ranked cached streams of the lowest resolution. When nothing is cached, only the recommended
 * stream (an uncached one is never retried).
 */
export function startCandidates(
  ranked: StreamOption[],
  maxRank: number | null,
  limit: number,
): { streams: StreamOption[]; cached: boolean } {
  const cached = ranked.filter((option) => option.cached);
  if (cached.length === 0) {
    const first = recommendStream(ranked, maxRank);
    return { streams: first ? [first] : [], cached: false };
  }
  const fitting = maxRank === null ? cached : cached.filter((option) => RESOLUTION_RANK[option.resolution] <= maxRank);
  if (fitting.length > 0) return { streams: fitting.slice(0, limit), cached: true };
  const lowest = Math.min(...cached.map((option) => RESOLUTION_RANK[option.resolution]));
  return {
    streams: cached.filter((option) => RESOLUTION_RANK[option.resolution] === lowest).slice(0, limit),
    cached: true,
  };
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
