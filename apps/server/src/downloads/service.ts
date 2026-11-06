import { randomUUID } from 'node:crypto';
import type {
  Download,
  DownloadFailedEvent,
  DownloadFailureReason,
  DownloadProgressEvent,
  DownloadStartedResponse,
  SessionStartRequest,
} from '@homestream/shared';
import type { FastifyBaseLogger } from 'fastify';
import type { Config } from '../config.js';
import type { Db } from '../db/index.js';
import { mediaKeyFor } from '../db/plays.js';
import { AppError } from '../errors.js';
import type { EventBus } from '../events/bus.js';
import { logEvent, type LogEventInput } from '../events/record.js';
import type { GatewayClient, PlaybackProbe } from '../gateway/client.js';
import { queryFromKey, queryKey, type StreamQuery } from '../gateway/types.js';
import { redact } from '../redact.js';
import type { StreamService } from '../streams/service.js';
import {
  DEFAULT_LIMITS,
  backoffMs,
  judgeItem,
  matchesHash,
  pollIntervalMs,
  shouldEmitProgress,
  type DownloadLimits,
  type TorboxItem,
} from './rules.js';
import { DownloadStore, type DownloadRow } from './store.js';
import { TorboxClient, TorboxError, type TorboxFetch } from './torbox.js';

/** How often a failing TorBox connection is mentioned in the log. */
const TORBOX_WARN_EVERY_MS = 10 * 60_000;
/** Without a TorBox match the gateway is asked (through the shared limiter) this often. */
const GATEWAY_CHECK_MS = 5 * 60_000;
const MAX_TIMER_MS = 2 ** 31 - 1;

export interface DownloadServiceOptions {
  config: Pick<Config, 'torboxApiKey' | 'torboxApiUrl' | 'configFile'>;
  db: Db;
  bus: EventBus;
  logger: FastifyBaseLogger;
  gateway: GatewayClient;
  streams: StreamService;
  now?: () => number;
  /** Test seam for the TorBox HTTP calls. */
  torboxFetch?: TorboxFetch;
  /** Test seam: time limits and intervals (see DEFAULT_LIMITS). */
  limits?: Partial<DownloadLimits>;
}

/** What `begin` needs to know about the title the client asked for. */
export interface BeginRequest {
  body: SessionStartRequest;
  title: string;
  imdbId: string;
  /** The best-ranked uncached stream that fits the device. */
  streamId: string;
}

function toDownload(row: DownloadRow): Download {
  const download: Download = {
    id: row.id,
    mediaType: row.mediaType,
    tmdbId: row.tmdbId,
    title: row.title,
    state: row.state,
    status: row.status,
    progress: row.progress,
    startedAt: row.createdAt,
  };
  if (row.season !== null) download.season = row.season;
  if (row.episode !== null) download.episode = row.episode;
  if (row.etaSec !== null && row.status === 'pending') download.etaSec = row.etaSec;
  if (row.reason) download.reason = row.reason;
  return download;
}

function eventBase(row: DownloadRow) {
  return {
    downloadId: row.id,
    title: row.title,
    mediaType: row.mediaType,
    tmdbId: row.tmdbId,
    ...(row.season !== null ? { season: row.season } : {}),
    ...(row.episode !== null ? { episode: row.episode } : {}),
  };
}

const FAILURE_MESSAGES: Record<DownloadFailureReason, string> = {
  torbox_error: 'TorBox reported an error for this download.',
  stalled: 'The download has had no seeds and no progress for 6 hours.',
  timeout: 'The download did not finish within 24 hours.',
};

function placeholderError(name: string): AppError {
  switch (name) {
    case 'store_limit_exceeded':
      return new AppError(
        409,
        'torbox_slots_full',
        'TorBox has no free download slots right now.',
        'Wait for a running TorBox download to finish or remove one in the TorBox dashboard, then try again.',
      );
    case '429':
      return new AppError(
        429,
        'gateway_rate_limited',
        'The stream gateway is rate limited right now.',
        'Wait a few minutes and try again.',
      );
    default:
      return new AppError(
        502,
        'download_failed',
        "TorBox couldn't start downloading this title.",
        'The release may be broken or gone. Try again later, or try another title.',
      );
  }
}

export class DownloadService {
  private readonly store: DownloadStore;
  private readonly limits: DownloadLimits;
  private readonly now: () => number;
  private readonly torbox: TorboxClient | null;
  private readonly starting = new Map<string, Promise<DownloadStartedResponse | null>>();
  private readonly lastGatewayCheck = new Map<string, number>();
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;
  private closed = false;
  private started = false;
  private torboxFailures = 0;
  private lastTorboxWarnAt = 0;
  private sseClients = 0;

  constructor(private readonly options: DownloadServiceOptions) {
    this.store = new DownloadStore(options.db);
    this.limits = { ...DEFAULT_LIMITS, ...options.limits };
    this.now = options.now ?? Date.now;
    const { torboxApiKey, torboxApiUrl } = options.config;
    this.torbox = torboxApiKey
      ? new TorboxClient({ baseUrl: torboxApiUrl, apiKey: torboxApiKey, fetch: options.torboxFetch })
      : null;
  }

  /** Resumes polling for downloads that were pending when the server last stopped. Call once at server start. */
  start(): void {
    if (this.started || this.closed) return;
    this.started = true;
    this.store.pruneFinished(this.now());
    const pending = this.store.listPending();
    if (pending.length > 0) {
      this.event({
        level: 'info',
        message: `Resumed tracking of ${pending.length} pending download${pending.length === 1 ? '' : 's'}.`,
        details: { count: pending.length },
      });
    }
    this.schedule();
  }

  close(): void {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  // --- API ---------------------------------------------------------------------------------------------------------

  list(): Download[] {
    return this.store.list().map(toDownload);
  }

  /** The pending download of a title, if any. No gateway or TMDB work. */
  existing(body: Pick<SessionStartRequest, 'mediaType' | 'tmdbId' | 'season' | 'episode'>): DownloadStartedResponse | null {
    const row = this.store.pendingForTitle(mediaKeyFor(body.mediaType, body.tmdbId, body.season, body.episode));
    if (!row) return null;
    this.event({
      level: 'info',
      message: `Play on "${row.title}" reused the pending download; nothing new was requested from TorBox.`,
      details: { downloadId: row.id },
    });
    return { status: 'downloading', download: toDownload(row) };
  }

  forMovie(tmdbId: number): Download | null {
    const row = this.store.pendingForTitle(mediaKeyFor('movie', tmdbId));
    return row ? toDownload(row) : null;
  }

  forShow(tmdbId: number): Download[] {
    return this.store.pendingForShow(tmdbId).map(toDownload);
  }

  /** Stops tracking. The TorBox item is left alone. False when the id is unknown. */
  cancel(id: string): boolean {
    const row = this.store.get(id);
    if (!row || !this.store.delete(id)) return false;
    this.lastGatewayCheck.delete(id);
    this.event({ level: 'info', message: `Stopped tracking the download of "${row.title}".`, details: { downloadId: id } });
    this.schedule();
    return true;
  }

  // --- Starting a download ------------------------------------------------------------------------------------------

  /**
   * Plays a title that has no cached stream: asks the gateway for the playback link of the best uncached stream once,
   * without following the redirect. Returns null when the link is already playable (the caller starts a normal session).
   */
  begin(request: BeginRequest): Promise<DownloadStartedResponse | null> {
    const { body } = request;
    const key = mediaKeyFor(body.mediaType, body.tmdbId, body.season, body.episode);
    const running = this.starting.get(key);
    if (running) return running;
    const promise = this.beginOnce(key, request).finally(() => this.starting.delete(key));
    this.starting.set(key, promise);
    return promise;
  }

  private async beginOnce(mediaKey: string, request: BeginRequest): Promise<DownloadStartedResponse | null> {
    const { body, title, imdbId } = request;
    const reused = this.existing(body);
    if (reused) return reused;

    const stream = await this.options.streams.getStreamById(request.streamId);
    if (!stream) return null;

    const probe = await this.options.gateway.probePlayback(stream.url);
    const outcome = this.interpret(probe, title);
    if (outcome === 'available') return null;

    const query: StreamQuery =
      body.mediaType === 'movie'
        ? { type: 'movie', imdbId }
        : { type: 'tv', imdbId, season: body.season as number, episode: body.episode as number };
    const now = this.now();
    const row = this.store.insert({
      id: randomUUID(),
      mediaKey,
      mediaType: body.mediaType,
      tmdbId: body.tmdbId,
      season: body.mediaType === 'tv' ? (body.season ?? null) : null,
      episode: body.mediaType === 'tv' ? (body.episode ?? null) : null,
      queryKey: queryKey(query),
      title,
      infoHash: stream.raw.infoHash ?? null,
      createdAt: now,
      nextPollAt: now + (this.torbox && stream.raw.infoHash ? this.limits.fastPollMs : GATEWAY_CHECK_MS),
    });
    this.lastGatewayCheck.set(row.id, now);
    this.event({
      level: 'info',
      message:
        outcome === 'timeout'
          ? `TorBox did not answer within the time limit; assuming it is downloading "${title}".`
          : `TorBox accepted "${title}" and started downloading it.`,
      details: { downloadId: row.id, tracked: row.infoHash !== null },
    });
    this.options.bus.emit('download.started', eventBase(row));
    this.schedule();
    return { status: 'downloading', download: toDownload(row) };
  }

  private interpret(probe: PlaybackProbe, title: string): 'accepted' | 'timeout' | 'available' {
    switch (probe.kind) {
      case 'available':
        this.event({ level: 'info', message: `The link for "${title}" is already playable; no download needed.` });
        return 'available';
      case 'timeout':
        return 'timeout';
      case 'rate_limited':
        this.event({ level: 'warn', message: `The gateway rate-limited the request to download "${title}".` });
        throw placeholderError('429');
      case 'failed':
        this.event({
          level: 'warn',
          message: `The gateway could not start the download of "${title}"${probe.status === null ? '' : ` (HTTP ${probe.status})`}.`,
        });
        throw placeholderError('download_failed');
      case 'placeholder':
        if (probe.name === 'downloading') return 'accepted';
        this.event({ level: 'warn', message: `TorBox refused the download of "${title}" (${probe.name}).`, details: { clip: probe.name } });
        throw placeholderError(probe.name);
    }
  }

  // --- Events -------------------------------------------------------------------------------------------------------

  /** The SSE route reports its open connections so ready notices are held for the next client when nobody listens. */
  clientConnected(): void {
    this.sseClients += 1;
  }

  clientDisconnected(): void {
    this.sseClients = Math.max(0, this.sseClients - 1);
  }

  /** Sends `download.ready` for downloads that finished while no client was connected. */
  replayUnnotified(): void {
    for (const row of this.store.unnotifiedReady()) {
      this.options.bus.emit('download.ready', eventBase(row));
      this.store.update(row.id, { notifiedAt: this.now() }, this.now());
    }
  }

  private event(input: Omit<LogEventInput, 'source'>): void {
    logEvent({ db: this.options.db, bus: this.options.bus }, { ...input, source: 'downloads' });
  }

  // --- Poller -------------------------------------------------------------------------------------------------------

  private schedule(): void {
    if (this.closed || !this.started) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const pending = this.store.listPending();
    if (pending.length === 0) return;
    const next = Math.min(...pending.map((row) => row.nextPollAt));
    const delay = Math.min(Math.max(0, next - this.now()), MAX_TIMER_MS);
    this.timer = setTimeout(() => void this.tick(), delay);
    this.timer.unref();
  }

  /** One poll cycle: every pending download whose time has come. Public so tests (and nothing else) can drive it. */
  async tick(): Promise<void> {
    if (this.ticking || this.closed) return;
    this.ticking = true;
    try {
      const due = this.store.listPending().filter((row) => row.nextPollAt <= this.now());
      if (due.length > 0) await this.pollDue(due);
    } catch (error) {
      this.options.logger.warn(`Download poll failed: ${redact(error instanceof Error ? error.message : String(error))}`);
    } finally {
      this.ticking = false;
      this.schedule();
    }
  }

  private async pollDue(due: DownloadRow[]): Promise<void> {
    const watching = due.filter((row) => row.readySince === null && row.infoHash !== null);
    let items: TorboxItem[] | null = null;
    let torboxUsable = this.torbox !== null;
    if (this.torbox && watching.length > 0) {
      try {
        items = await this.torbox.list();
        this.noteTorboxRecovered();
      } catch (error) {
        const failure = error instanceof TorboxError ? error : new TorboxError('unavailable', 'TorBox could not be read');
        torboxUsable = failure.kind !== 'auth';
        this.noteTorboxFailure(failure);
      }
    }
    const listFailed = items === null && torboxUsable && this.torbox !== null && watching.length > 0;

    for (const row of this.freshRows(due)) {
      try {
        await this.pollRow(row, items, torboxUsable, listFailed);
      } catch (error) {
        this.options.logger.warn(`Download ${row.id} poll failed: ${redact(error instanceof Error ? error.message : String(error))}`);
        this.store.update(row.id, { nextPollAt: this.now() + this.limits.fastPollMs }, this.now());
      }
    }
  }

  /** Rows may have been cancelled while the TorBox list was in flight. */
  private freshRows(rows: DownloadRow[]): DownloadRow[] {
    return rows.map((row) => this.store.get(row.id)).filter((row): row is DownloadRow => row !== null && row.status === 'pending');
  }

  private async pollRow(row: DownloadRow, items: TorboxItem[] | null, torboxUsable: boolean, listFailed: boolean): Promise<void> {
    const now = this.now();
    const age = now - row.createdAt;
    const interval = pollIntervalMs(age, this.limits);

    if (row.readySince !== null) {
      await this.confirm(row);
      return;
    }
    if (age >= this.limits.giveUpMs) {
      this.fail(row, 'timeout');
      return;
    }

    const tracked = this.torbox !== null && torboxUsable && row.infoHash !== null;
    if (!tracked) {
      await this.checkGateway(row, GATEWAY_CHECK_MS, GATEWAY_CHECK_MS);
      return;
    }
    if (listFailed) {
      this.store.update(row.id, { nextPollAt: now + backoffMs(interval, this.torboxFailures, this.limits) }, now);
      return;
    }

    const item = (items ?? []).find((candidate) => matchesHash(candidate, row.infoHash as string));
    if (!item) {
      // TorBox does not list the item (yet, or any more): fall back to asking the gateway now and then.
      await this.checkGateway(row, interval, GATEWAY_CHECK_MS);
      return;
    }

    const verdict = judgeItem(item, row, now, this.limits);
    if (verdict.kind === 'failed') {
      this.fail(row, verdict.reason);
      return;
    }
    if (verdict.kind === 'ready') {
      this.store.update(row.id, { state: 'downloading', progress: 1, etaSec: null, readySince: now, nextPollAt: now }, now);
      this.event({ level: 'info', message: `TorBox finished "${row.title}"; checking that it is listed as cached.`, details: { downloadId: row.id } });
      await this.confirm(this.store.get(row.id) as DownloadRow);
      return;
    }

    const progress = Math.max(row.progress, verdict.progress);
    const emit = shouldEmitProgress(row, progress, now, this.limits);
    this.store.update(
      row.id,
      {
        state: 'downloading',
        progress,
        etaSec: verdict.etaSec,
        nextPollAt: now + interval,
        progressChangedAt: progress > row.progress + 1e-6 ? now : row.progressChangedAt,
        ...(emit ? { lastEventAt: now } : {}),
      },
      now,
    );
    if (row.state !== 'downloading') {
      this.event({ level: 'info', message: `TorBox is downloading "${row.title}".`, details: { downloadId: row.id } });
    }
    if (emit) {
      const payload: DownloadProgressEvent = { ...eventBase(row), progress, state: 'downloading' };
      if (verdict.etaSec !== null) payload.etaSec = verdict.etaSec;
      this.options.bus.emit('download.progress', payload);
    }
  }

  /** Asks the gateway (bypassing its list cache) whether a cached stream exists; ready when it does. */
  private async checkGateway(row: DownloadRow, nextInMs: number, throttleMs = 0): Promise<void> {
    const now = this.now();
    this.store.update(row.id, { nextPollAt: now + nextInMs }, now);
    const last = this.lastGatewayCheck.get(row.id) ?? row.createdAt;
    if (now - last < throttleMs) return;
    this.lastGatewayCheck.set(row.id, now);
    if (await this.hasCachedStream(row)) this.markReady(row, 'The gateway lists a cached stream.');
  }

  /** TorBox finished the item; wait for the gateway to show a cached stream, but not forever. */
  private async confirm(row: DownloadRow): Promise<void> {
    const now = this.now();
    if (await this.hasCachedStream(row)) {
      this.markReady(row, 'The gateway lists a cached stream.');
      return;
    }
    const waited = now - (row.readySince ?? now);
    if (waited >= this.limits.confirmWindowMs) {
      this.markReady(row, 'The gateway still lists it as not cached, but TorBox has finished; Play opens the link directly.');
      return;
    }
    this.store.update(row.id, { nextPollAt: now + this.limits.confirmRetryMs }, now);
  }

  private async hasCachedStream(row: DownloadRow): Promise<boolean> {
    const query = queryFromKey(row.queryKey);
    if (!query) return false;
    try {
      const listed = await this.options.streams.refresh(query);
      return listed.streams.some((stream) => stream.cached);
    } catch (error) {
      this.options.logger.warn(`Download re-check failed: ${redact(error instanceof Error ? error.message : String(error))}`);
      return false;
    }
  }

  private markReady(row: DownloadRow, note: string): void {
    const live = this.store.get(row.id);
    if (!live || live.status !== 'pending') return;
    const now = this.now();
    const notified = this.sseClients > 0;
    this.store.update(
      row.id,
      { status: 'ready', state: 'ready', progress: 1, etaSec: null, reason: null, notifiedAt: notified ? now : null },
      now,
    );
    this.event({ level: 'info', message: `"${row.title}" is ready to watch. ${note}`, details: { downloadId: row.id } });
    this.options.bus.emit('download.ready', eventBase(row));
  }

  private fail(row: DownloadRow, reason: DownloadFailureReason): void {
    const live = this.store.get(row.id);
    if (!live || live.status !== 'pending') return;
    const now = this.now();
    this.store.update(row.id, { status: 'failed', state: 'failed', reason, etaSec: null }, now);
    this.event({
      level: 'warn',
      message: `The download of "${row.title}" failed: ${FAILURE_MESSAGES[reason]}`,
      details: { downloadId: row.id, reason },
    });
    const payload: DownloadFailedEvent = { ...eventBase(row), reason, message: FAILURE_MESSAGES[reason] };
    this.options.bus.emit('download.failed', payload);
  }

  private noteTorboxRecovered(): void {
    if (this.torboxFailures > 0) {
      this.event({ level: 'info', message: 'TorBox answers again; download polling is back to normal.' });
    }
    this.torboxFailures = 0;
  }

  private noteTorboxFailure(failure: TorboxError): void {
    this.torboxFailures += 1;
    const now = this.now();
    if (now - this.lastTorboxWarnAt < TORBOX_WARN_EVERY_MS && this.torboxFailures > 1) return;
    this.lastTorboxWarnAt = now;
    const hint =
      failure.kind === 'auth'
        ? `Check TORBOX_API_KEY in ${this.options.config.configFile.path}. Downloads are checked through the gateway meanwhile.`
        : 'Download progress is checked again later.';
    this.event({ level: 'warn', message: `${failure.message}. ${hint}`, details: { failures: this.torboxFailures } });
  }
}
