import type {
  DeviceStat,
  HistoryItem,
  KeyedBucket,
  MostWatched,
  StatsGraphsResponse,
  StatsSummaryResponse,
} from '@homestream/shared';

/** The columns of a play record the statistics read. */
export type StatsPlay = Pick<
  HistoryItem,
  | 'type'
  | 'tmdbId'
  | 'title'
  | 'showTitle'
  | 'deviceId'
  | 'deviceName'
  | 'deviceKind'
  | 'startedAt'
  | 'watchedSec'
  | 'bytesServed'
  | 'decision'
>;

const TOP_LIMIT = 10;

/** Local midnight of the first of the last `days` calendar days (today counts as one). */
export function windowStart(now: number, days: number): number {
  const date = new Date(now);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() - (days - 1)).getTime();
}

function inWindow(plays: StatsPlay[], now: number, days: number): StatsPlay[] {
  const start = windowStart(now, days);
  return plays.filter((play) => play.startedAt >= start);
}

interface Tally {
  plays: number;
  watchSec: number;
}

function add(tally: Tally, play: StatsPlay): void {
  tally.plays += 1;
  tally.watchSec += play.watchedSec;
}

function byPlaysThenWatch<T extends Tally>(a: T, b: T): number {
  return b.plays - a.plays || b.watchSec - a.watchSec;
}

function mostWatched(plays: StatsPlay[], type: 'movie' | 'tv'): MostWatched[] {
  const groups = new Map<number, MostWatched>();
  for (const play of plays) {
    if (play.type !== type) continue;
    const name = type === 'tv' ? play.showTitle || play.title : play.title;
    const group = groups.get(play.tmdbId) ?? { tmdbId: play.tmdbId, title: name, plays: 0, watchSec: 0 };
    add(group, play);
    groups.set(play.tmdbId, group);
  }
  return [...groups.values()]
    .sort((a, b) => byPlaysThenWatch(a, b) || a.title.localeCompare(b.title))
    .slice(0, TOP_LIMIT);
}

function deviceStats(plays: StatsPlay[]): DeviceStat[] {
  const groups = new Map<string, DeviceStat>();
  for (const play of plays) {
    const deviceId = play.deviceId ?? 'unknown';
    const group = groups.get(deviceId) ?? {
      deviceId,
      deviceName: play.deviceName ?? 'Unknown device',
      deviceKind: play.deviceKind,
      plays: 0,
      watchSec: 0,
    };
    add(group, play);
    groups.set(deviceId, group);
  }
  return [...groups.values()];
}

export function summarize(plays: StatsPlay[], days: number, now: number): StatsSummaryResponse {
  const inRange = inWindow(plays, now, days);
  return {
    days,
    totalPlays: inRange.length,
    totalWatchSec: inRange.reduce((sum, play) => sum + play.watchedSec, 0),
    bytesServed: inRange.reduce((sum, play) => sum + play.bytesServed, 0),
    mostWatchedMovies: mostWatched(inRange, 'movie'),
    mostWatchedShows: mostWatched(inRange, 'tv'),
    topDevices: deviceStats(inRange)
      .sort((a, b) => b.watchSec - a.watchSec || b.plays - a.plays || a.deviceId.localeCompare(b.deviceId))
      .slice(0, TOP_LIMIT),
  };
}

function dayKey(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** What the stored decision says about the output: dynamic range (tone-mapped wins over sdr), codec and resolution. */
export function decisionKeys(decision: StatsPlay['decision']): {
  dynamicRange: string;
  codec: string;
  resolution: string;
} {
  const range = decision?.toneMapped ? 'tone-mapped' : decision?.dynamicRange;
  return {
    dynamicRange: range || 'unknown',
    codec: decision?.videoCodec || 'unknown',
    resolution: decision?.height ? `${decision.height}p` : 'unknown',
  };
}

function keyed(plays: StatsPlay[], pick: (play: StatsPlay) => string, order: readonly string[] = []): KeyedBucket[] {
  const groups = new Map<string, KeyedBucket>();
  for (const play of plays) {
    const key = pick(play);
    const group = groups.get(key) ?? { key, plays: 0, watchSec: 0 };
    add(group, play);
    groups.set(key, group);
  }
  const rank = (key: string) => {
    const index = order.indexOf(key);
    return index < 0 ? order.length : index;
  };
  return [...groups.values()].sort(
    (a, b) => rank(a.key) - rank(b.key) || byPlaysThenWatch(a, b) || a.key.localeCompare(b.key),
  );
}

function resolutionHeight(key: string): number {
  return Number.parseInt(key, 10) || 0;
}

export function graphs(plays: StatsPlay[], days: number, now: number): StatsGraphsResponse {
  const inRange = inWindow(plays, now, days);
  const start = windowStart(now, days);

  const byDay = new Map<string, { date: string } & Tally>();
  for (let offset = 0; offset < days; offset += 1) {
    const day = new Date(start);
    day.setDate(day.getDate() + offset);
    const date = dayKey(day);
    byDay.set(date, { date, plays: 0, watchSec: 0 });
  }
  const byHour = Array.from({ length: 24 }, (_, hour) => ({ hour, plays: 0, watchSec: 0 }));
  const byDayOfWeek = Array.from({ length: 7 }, (_, dayOfWeek) => ({ dayOfWeek, plays: 0, watchSec: 0 }));
  for (const play of inRange) {
    const date = new Date(play.startedAt);
    // A play from the future (clock change) has no bucket in the window; the hour and weekday charts still count it.
    const day = byDay.get(dayKey(date));
    if (day) add(day, play);
    add(byHour[date.getHours()] as Tally, play);
    add(byDayOfWeek[date.getDay()] as Tally, play);
  }

  return {
    days,
    byDay: [...byDay.values()],
    byHour,
    byDayOfWeek,
    byDevice: deviceStats(inRange).sort((a, b) => byPlaysThenWatch(a, b) || a.deviceId.localeCompare(b.deviceId)),
    byDecision: {
      dynamicRange: keyed(inRange, (play) => decisionKeys(play.decision).dynamicRange, ['sdr', 'hdr10', 'tone-mapped']),
      codec: keyed(inRange, (play) => decisionKeys(play.decision).codec, ['hevc', 'h264']),
      resolution: keyed(inRange, (play) => decisionKeys(play.decision).resolution).sort(
        (a, b) => resolutionHeight(b.key) - resolutionHeight(a.key) || a.key.localeCompare(b.key),
      ),
    },
  };
}
