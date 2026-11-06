import type { CapabilityProfile, PrefetchRequest, PrefetchResponse } from '@homestream/shared';
import type { FastifyBaseLogger } from 'fastify';
import type { Db } from '../db/index.js';
import { upsertDevice } from '../db/devices.js';
import { mediaKeyFor } from '../db/plays.js';
import type { EventBus } from '../events/bus.js';
import { logEvent, type LogEventInput } from '../events/record.js';
import { redact } from '../redact.js';
import { PREFETCH_OWNER, type SourceProxy } from '../sourceproxy/proxy.js';
import type { StreamService } from '../streams/service.js';
import { deviceMaxRank } from '../streams/rank.js';
import type { StreamQuery } from '../gateway/types.js';
import type { TmdbService } from '../tmdb/service.js';

/** How long the reply waits for the stream id; a cold TMDB or gateway lookup is answered with null instead. */
const STREAM_ID_BUDGET_MS = 300;
/** A finished prefetch keeps absorbing duplicates for this long. */
const MERGE_WINDOW_MS = 60_000;

export interface PrefetchServiceOptions {
  tmdb: TmdbService;
  streams: StreamService;
  proxy: SourceProxy;
  db: Db;
  bus: EventBus;
  logger: FastifyBaseLogger;
  streamIdBudgetMs?: number;
}

interface Run {
  /** Settles as soon as the stream is chosen (or known to be unavailable). */
  streamId: Promise<string | null>;
  done: Promise<void>;
  finishedAt: number | null;
  succeeded: boolean;
}

function describe(error: unknown): string {
  return redact(error instanceof Error ? error.message : 'unexpected error').replace(
    /\b(?:https?|ftp):\/\/\S+/gi,
    '<url>',
  );
}

/**
 * Background warm-up for the stream a following `POST /api/sessions` with `streamId: "auto"` would pick: resolves the link,
 * loads head and tail into the source proxy and runs ffprobe once. Never throws to the caller.
 */
export class PrefetchService {
  private readonly runs = new Map<string, Run>();

  constructor(private readonly options: PrefetchServiceOptions) {}

  async request(body: PrefetchRequest, clientIp: string | null): Promise<PrefetchResponse> {
    const { db } = this.options;
    const device = upsertDevice(db, body.device, clientIp).capabilities;
    const mediaKey = mediaKeyFor(body.mediaType, body.tmdbId, body.season, body.episode);
    // Streams are ranked per resolution tier, so devices of one tier get the same stream and share the warm-up.
    const key = `${mediaKey}|${deviceMaxRank(device)}`;

    const now = Date.now();
    let run = this.runs.get(key);
    if (run?.finishedAt && (now - run.finishedAt > MERGE_WINDOW_MS || !run.succeeded)) {
      this.runs.delete(key);
      run = undefined;
    }
    const merged = run !== undefined;
    this.event({
      level: 'info',
      source: 'prefetch',
      message: `Prefetch ${merged ? 'merged' : 'requested'} for ${mediaKey} on a ${device.kind} device.`,
      details: { mediaKey, deviceKind: device.kind, merged },
    });
    if (!run) {
      run = this.start(key, body, device, mediaKey);
      this.runs.set(key, run);
    }

    const budget = new Promise<null>((resolve) => {
      const timer = setTimeout(() => resolve(null), this.options.streamIdBudgetMs ?? STREAM_ID_BUDGET_MS);
      timer.unref();
    });
    return { streamId: await Promise.race([run.streamId, budget]) };
  }

  /** Resolves when every running warm-up has finished (tests and shutdown). */
  async idle(): Promise<void> {
    await Promise.all([...this.runs.values()].map((run) => run.done));
  }

  private start(key: string, body: PrefetchRequest, device: CapabilityProfile, mediaKey: string): Run {
    const run: Run = { streamId: Promise.resolve(null), done: Promise.resolve(), finishedAt: null, succeeded: false };
    let announce: (id: string | null) => void = () => undefined;
    run.streamId = new Promise<string | null>((resolve) => {
      announce = resolve;
    });
    run.done = this.warm(body, device, mediaKey, announce)
      .then((succeeded) => {
        run.succeeded = succeeded;
      })
      .catch((error: unknown) => {
        this.event({
          level: 'warn',
          source: 'prefetch',
          message: `Prefetch for ${mediaKey} failed: ${describe(error)}`,
          details: { mediaKey, deviceKind: device.kind },
        });
      })
      .finally(() => {
        announce(null);
        run.finishedAt = Date.now();
        if (!run.succeeded && this.runs.get(key) === run) this.runs.delete(key);
      });
    return run;
  }

  private async warm(
    body: PrefetchRequest,
    device: CapabilityProfile,
    mediaKey: string,
    announce: (streamId: string | null) => void,
  ): Promise<boolean> {
    const { tmdb, streams, proxy } = this.options;
    const details = body.mediaType === 'movie' ? await tmdb.movie(body.tmdbId) : await tmdb.show(body.tmdbId);
    if (!details.imdbId) {
      this.skipped(mediaKey, device, 'the title has no IMDb id');
      return false;
    }
    const query: StreamQuery =
      body.mediaType === 'movie'
        ? { type: 'movie', imdbId: details.imdbId }
        : { type: 'tv', imdbId: details.imdbId, season: body.season as number, episode: body.episode as number };

    const listed = streams.cachedList(query, device.deviceId) ?? (await streams.list(query, device.deviceId));
    const chosen = listed.streams.find((stream) => stream.id === listed.recommendedId);
    if (!chosen) {
      this.skipped(mediaKey, device, 'no stream is available');
      return false;
    }
    if (!chosen.cached) {
      this.skipped(mediaKey, device, 'the recommended stream is not cached on TorBox');
      return false;
    }
    announce(chosen.id);

    const resolved = await streams.getStreamById(chosen.id);
    if (!resolved) {
      this.skipped(mediaKey, device, 'the stream is no longer offered');
      return false;
    }
    const started = Date.now();
    const source = await proxy.acquire(resolved.url, PREFETCH_OWNER);
    try {
      await source.probe();
    } catch (error) {
      source.release();
      throw error;
    }
    this.options.logger.info({ mediaKey, deviceKind: device.kind, tookMs: Date.now() - started }, 'Prefetch finished');
    return true;
  }

  private skipped(mediaKey: string, device: CapabilityProfile, reason: string): void {
    this.event({
      level: 'info',
      source: 'prefetch',
      message: `Nothing to prefetch for ${mediaKey}: ${reason}.`,
      details: { mediaKey, deviceKind: device.kind },
    });
  }

  private event(input: LogEventInput): void {
    try {
      logEvent({ db: this.options.db, bus: this.options.bus }, input);
    } catch (error) {
      this.options.logger.warn({ err: error }, 'Could not record an event');
    }
  }
}
