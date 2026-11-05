/**
 * The gateway sometimes pads a lookup for a missing episode with season packs of other seasons.
 * Only an explicit season/episode marker that contradicts the request counts as a mismatch;
 * names without any marker are kept.
 */
export function matchesEpisode(filename: string, season: number, episode: number): boolean {
  const text = filename.toLowerCase();

  const full = /(?<![a-z0-9])s(\d{1,2})[ ._-]?e(\d{1,3})(?:(?:[ ._-]?e|-)(\d{1,3}))?/.exec(text);
  if (full) {
    const first = Number(full[2]);
    const last = full[3] ? Number(full[3]) : first;
    return Number(full[1]) === season && episode >= Math.min(first, last) && episode <= Math.max(first, last);
  }

  const cross = /(?<![a-z0-9])(\d{1,2})x(\d{2,3})(?![a-z0-9])/.exec(text);
  if (cross && !/\d{3,4}x\d{3,4}/.test(text)) return Number(cross[1]) === season && Number(cross[2]) === episode;

  const range = /(?<![a-z0-9])s(\d{1,2})[ ._-]+s?(\d{1,2})(?![a-z0-9])/.exec(text);
  if (range) return season >= Number(range[1]) && season <= Number(range[2]);

  const seasonOnly = /(?<![a-z0-9])s(\d{1,2})(?![a-z0-9]|\d)/.exec(text) ?? /\bseason[ ._-]?(\d{1,2})\b/.exec(text);
  if (seasonOnly) return Number(seasonOnly[1]) === season;

  return true;
}
