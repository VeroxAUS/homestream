import { describe, expect, it } from 'vitest';
import { matchesEpisode } from '../../src/streams/episode.js';

describe('matchesEpisode', () => {
  it.each<[string, number, number, boolean]>([
    ['Breaking.Bad.S01E01.Pilot.1080p.BluRay.x264-GRP.mkv', 1, 1, true],
    ['Breaking.Bad.S01E01.Pilot.1080p.BluRay.x264-GRP.mkv', 1, 2, false],
    ['Breaking.Bad.S01E01.Pilot.1080p.BluRay.x264-GRP.mkv', 2, 1, false],
    ['Breaking Bad s1e1 720p.mkv', 1, 1, true],
    ['Show.S01E01-E03.1080p.mkv', 1, 2, true],
    ['Show.S01E01E02.1080p.mkv', 1, 2, true],
    ['Show.S01E01E02.1080p.mkv', 1, 3, false],
    ['Show.1x05.720p.mkv', 1, 5, true],
    ['Show.1x05.720p.mkv', 1, 6, false],
    ['Breaking Bad S04-720 Movies-daily.com', 99, 99, false],
    ['Breaking Bad S01-720 Movies-daily com', 1, 3, true],
    ['Breaking.Bad.Complete.S01-S05.1080p.mkv', 3, 4, true],
    ['Breaking.Bad.Complete.S01-S05.1080p.mkv', 6, 1, false],
    ['Breaking Bad Season 2 1080p', 2, 5, true],
    ['Breaking Bad Season 2 1080p', 3, 5, false],
    ['Some.Movie.3840x2160.mkv', 1, 1, true],
    ['DTS5.1.mkv', 1, 1, true],
    ['Breaking Bad 1080p WEB-DL', 2, 2, true],
    ['', 1, 1, true],
  ])('%s S%i E%i -> %s', (filename, season, episode, expected) => {
    expect(matchesEpisode(filename, season, episode)).toBe(expected);
  });
});
