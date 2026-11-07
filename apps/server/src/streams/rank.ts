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

/** Minimum [short side, long side] of the 2160p, 1440p, 1080p and 720p tiers; reaching either one qualifies. */
const TIER_MINIMUMS: ReadonlyArray<readonly [number, number]> = [
  [2160, 3840],
  [1440, 2560],
  [1080, 1920],
  [720, 1280],
];

/**
 * Highest resolution tier (5 down to 1) a device can show, from its reported maximum display size.
 * The sides are compared as long and short, so a portrait profile gives the same tier as its landscape form.
 */
export function deviceMaxRank(profile: Pick<CapabilityProfile, 'maxWidth' | 'maxHeight'>): number {
  const long = Math.max(profile.maxWidth, profile.maxHeight);
  const short = Math.min(profile.maxWidth, profile.maxHeight);
  const index = TIER_MINIMUMS.findIndex(([shortMinimum, longMinimum]) => short >= shortMinimum || long >= longMinimum);
  return index === -1 ? 1 : 5 - index;
}

/**
 * Streams in the order a device should try them: known resolutions that fit (ranked order), then known resolutions
 * above the device, lowest tier first (ranked order within a tier), then unknown resolution. Unknown never counts as fitting.
 */
function deviceOrder(ranked: StreamOption[], maxRank: number | null): StreamOption[] {
  const rank = (option: StreamOption) => RESOLUTION_RANK[option.resolution];
  const known = ranked.filter((option) => rank(option) > 0);
  const unknown = ranked.filter((option) => rank(option) === 0);
  if (maxRank === null) return [...known, ...unknown];
  const fitting = known.filter((option) => rank(option) <= maxRank);
  const above = known.filter((option) => rank(option) > maxRank).sort((a, b) => rank(a) - rank(b));
  return [...fitting, ...above, ...unknown];
}

/**
 * Streams an automatic start may try, best first (see `deviceOrder`), at most `limit`. Uncached streams are never
 * candidates: when nothing is cached, only the recommended stream (an uncached one is never retried).
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
  return { streams: deviceOrder(cached, maxRank).slice(0, limit), cached: true };
}

/** First stream in the device order: unknown resolution is recommended only when no known resolution exists. */
export function recommendStream(ranked: StreamOption[], maxRank: number | null): StreamOption | null {
  return deviceOrder(ranked, maxRank)[0] ?? null;
}
