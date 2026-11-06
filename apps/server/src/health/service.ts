import {
  HEALTH_CHECK_IDS,
  type HealthCheck,
  type HealthCheckId,
  type HealthResponse,
  type HealthStatus,
} from '@homestream/shared';
import type { FastifyBaseLogger } from 'fastify';
import type { Config } from '../config.js';
import type { Db } from '../db/index.js';
import type { EventBus } from '../events/bus.js';
import { countSessionErrors, recentSessionErrors } from '../events/query.js';
import { logEvent, type EventSource } from '../events/record.js';
import type { GatewayClient } from '../gateway/client.js';
import { buildNetworkCheck } from '../network/check.js';
import { networkSnapshot } from '../network/snapshot.js';
import type { PlaybackManager } from '../playback/manager.js';
import { redactDeep } from '../redact.js';
import type { SourceProxy } from '../sourceproxy/proxy.js';
import type { TmdbService } from '../tmdb/service.js';
import { checkConfig } from './checks/config.js';
import { checkDisk } from './checks/disk.js';
import { checkFfmpeg } from './checks/ffmpeg.js';
import { checkGateway, type HealthFetch } from './checks/gateway.js';
import { checkGpu } from './checks/gpu.js';
import { checkSessions, RECENT_ERROR_WINDOW_MS } from './checks/sessions.js';
import { checkTmdb } from './checks/tmdb.js';
import { checkTorbox } from './checks/torbox.js';
import type { CheckOutcome } from './checks/types.js';
import { diskSpace, runCommand, type CommandRunner, type DiskProbe } from './exec.js';

const HEALTH_INTERVAL_MS = 60_000;
const LIVE_INTERVAL_MS = 5_000;
const TORBOX_CACHE_MS = 5 * 60_000;
const FFMPEG_CACHE_MS = 10 * 60_000;

const NAMES: Record<HealthCheckId, string> = {
  config: 'Configuration',
  gateway: 'Stream gateway',
  torbox: 'TorBox',
  tmdb: 'TMDB',
  ffmpeg: 'ffmpeg / NVENC',
  gpu: 'GPU',
  disk: 'Disk space',
  sessions: 'Playback sessions',
  network: 'Download rate',
};

/** Where the status-change event for a check is filed; the log view can then be filtered by the service that broke. */
const EVENT_SOURCE: Record<HealthCheckId, EventSource> = {
  config: 'health',
  gateway: 'gateway',
  torbox: 'torbox',
  tmdb: 'tmdb',
  ffmpeg: 'ffmpeg',
  gpu: 'health',
  disk: 'health',
  sessions: 'health',
  network: 'health',
};

const RANK: Record<HealthStatus, number> = { ok: 0, warn: 1, error: 2 };

export interface HealthServiceDeps {
  config: Config;
  db: Db;
  bus: EventBus;
  logger: FastifyBaseLogger;
  gateway: GatewayClient;
  tmdb: TmdbService;
  playback: PlaybackManager;
  sourceProxy: SourceProxy;
  /** Test seams: network, child processes, disk and the clock. */
  fetch?: HealthFetch;
  run?: CommandRunner;
  diskProbe?: DiskProbe;
  now?: () => number;
  intervalMs?: number;
  liveIntervalMs?: number;
}

interface CacheEntry {
  atMs: number;
  check: HealthCheck;
}

function worstStatus(checks: readonly { status: HealthStatus }[]): HealthStatus {
  return checks.reduce<HealthStatus>((worst, check) => (RANK[check.status] > RANK[worst] ? check.status : worst), 'ok');
}

export class HealthService {
  private snapshot: HealthResponse | null = null;
  private inflight: Promise<HealthResponse> | null = null;
  private forceEmit = false;
  private torboxCache: CacheEntry | null = null;
  private ffmpegCache: CacheEntry | null = null;
  private timer: NodeJS.Timeout | null = null;
  private liveTimer: NodeJS.Timeout | null = null;
  private readonly now: () => number;
  private readonly fetchImpl: HealthFetch;
  private readonly run_: CommandRunner;
  private readonly diskProbe: DiskProbe;

  constructor(private readonly deps: HealthServiceDeps) {
    this.now = deps.now ?? Date.now;
    this.fetchImpl = deps.fetch ?? ((url, init) => fetch(url, init));
    this.run_ = deps.run ?? runCommand;
    this.diskProbe = deps.diskProbe ?? diskSpace;
  }

  /** First run now (not awaited), then every 60 s; a lighter pass keeps the in-memory checks (network, sessions) current in between. */
  start(): void {
    if (this.timer) return;
    void this.run('background');
    this.timer = setInterval(() => void this.run('background'), this.deps.intervalMs ?? HEALTH_INTERVAL_MS);
    this.liveTimer = setInterval(() => this.refreshLive(), this.deps.liveIntervalMs ?? LIVE_INTERVAL_MS);
    this.timer.unref();
    this.liveTimer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.liveTimer) clearInterval(this.liveTimer);
    this.timer = null;
    this.liveTimer = null;
  }

  /** The latest snapshot with the live checks refreshed; runs the checks first when nothing has run yet. */
  async get(): Promise<HealthResponse> {
    if (!this.snapshot) return this.run('background');
    this.refreshLive();
    return this.copy();
  }

  /**
   * Runs every check. `fresh` also drops the torbox (5 min) and ffmpeg (10 min) caches; without it those keep their measured time,
   * which protects the TorBox rate limit and avoids a GPU encode on every click.
   */
  async run(trigger: 'background' | 'manual', fresh = false): Promise<HealthResponse> {
    if (trigger === 'manual') this.forceEmit = true;
    if (this.inflight && !fresh) return this.inflight;
    const pending = this.runAll(fresh).finally(() => {
      if (this.inflight === pending) this.inflight = null;
    });
    this.inflight = pending;
    return pending;
  }

  private copy(): HealthResponse {
    const snapshot = this.snapshot as HealthResponse;
    return { overall: snapshot.overall, checks: snapshot.checks.map((check) => ({ ...check })) };
  }

  private async runAll(fresh: boolean): Promise<HealthResponse> {
    const checks = await Promise.all([
      this.measure('config', () => checkConfig(this.deps.config)),
      this.measure('gateway', () =>
        checkGateway({ config: this.deps.config, stats: this.deps.gateway.stats, fetch: this.fetchImpl }),
      ),
      this.torbox(fresh),
      this.measure('tmdb', () => checkTmdb({ config: this.deps.config, ping: () => this.deps.tmdb.ping() })),
      this.ffmpeg(fresh),
      this.measure('gpu', () => checkGpu({ run: this.run_ })),
      this.measure('disk', () => this.disk()),
      this.measure('sessions', () => this.sessions()),
      Promise.resolve(this.network()),
    ]);
    const ordered = HEALTH_CHECK_IDS.map((id) => checks.find((check) => check.id === id) as HealthCheck);
    const next: HealthResponse = { overall: worstStatus(ordered), checks: ordered };
    return this.publish(next);
  }

  /** Stores the snapshot, records status changes as events and pushes the snapshot over SSE when something changed or a run was requested. */
  private publish(next: HealthResponse): HealthResponse {
    const previous = this.snapshot;
    const changed = this.recordChanges(previous, next);
    this.snapshot = next;
    if (changed || this.forceEmit || !previous) this.deps.bus.emit('health', { ...this.copy() });
    this.forceEmit = false;
    return this.copy();
  }

  /** Re-reads only the checks that are cheap and live (no network, no child process). */
  private refreshLive(): void {
    const current = this.snapshot;
    if (!current) return;
    const live = [this.measureSync('sessions', () => this.sessions()), this.network()];
    const checks = current.checks.map((check) => live.find((item) => item.id === check.id) ?? check);
    const next: HealthResponse = { overall: worstStatus(checks), checks };
    const changed = this.recordChanges(current, next);
    this.snapshot = next;
    if (changed) this.deps.bus.emit('health', { ...this.copy() });
  }

  private recordChanges(previous: HealthResponse | null, next: HealthResponse): boolean {
    let changed = !previous || previous.overall !== next.overall;
    for (const check of next.checks) {
      const before = previous?.checks.find((item) => item.id === check.id)?.status;
      if (before === check.status) continue;
      changed = true;
      if (before === undefined && check.status === 'ok') continue;
      this.logChange(check, before);
    }
    return changed;
  }

  private logChange(check: HealthCheck, before: HealthStatus | undefined): void {
    const recovered = check.status === 'ok';
    try {
      logEvent(
        { db: this.deps.db, bus: this.deps.bus },
        {
          level: check.status === 'ok' ? 'info' : check.status,
          source: EVENT_SOURCE[check.id],
          message: recovered ? `${check.name} is ok again: ${check.message}` : `${check.name}: ${check.message}`,
          details: {
            check: check.id,
            status: check.status,
            previous: before ?? null,
            ...(check.hint ? { hint: check.hint } : {}),
          },
        },
      );
    } catch (error) {
      this.deps.logger.warn({ err: error }, 'Could not record a health status change');
    }
  }

  private build(id: HealthCheckId, outcome: CheckOutcome, latencyMs: number, checkedAt: string): HealthCheck {
    const check: HealthCheck = {
      id,
      name: NAMES[id],
      status: outcome.status,
      message: outcome.message,
      latencyMs,
      checkedAt,
      details: outcome.details,
    };
    if (outcome.status !== 'ok')
      check.hint = outcome.hint ?? 'Run the check again; if it keeps failing, look at the server log.';
    return redactDeep(check);
  }

  private crashed(id: HealthCheckId, error: unknown): CheckOutcome {
    this.deps.logger.warn({ err: error }, `Health check ${id} failed to run`);
    return {
      status: 'error',
      message: 'This check could not run.',
      hint: 'Run the checks again; if it keeps failing, look at the server log for the reason.',
      details: {},
    };
  }

  private async measure(id: HealthCheckId, fn: () => CheckOutcome | Promise<CheckOutcome>): Promise<HealthCheck> {
    const started = this.now();
    let outcome: CheckOutcome;
    try {
      outcome = await fn();
    } catch (error) {
      outcome = this.crashed(id, error);
    }
    return this.build(id, outcome, Math.max(0, this.now() - started), new Date(this.now()).toISOString());
  }

  private measureSync(id: HealthCheckId, fn: () => CheckOutcome): HealthCheck {
    const started = this.now();
    let outcome: CheckOutcome;
    try {
      outcome = fn();
    } catch (error) {
      outcome = this.crashed(id, error);
    }
    return this.build(id, outcome, Math.max(0, this.now() - started), new Date(this.now()).toISOString());
  }

  private async torbox(fresh: boolean): Promise<HealthCheck> {
    const cached = this.torboxCache;
    if (!fresh && cached && this.now() - cached.atMs < TORBOX_CACHE_MS) return cached.check;
    const check = await this.measure('torbox', () =>
      checkTorbox({ config: this.deps.config, fetch: this.fetchImpl, nowMs: this.now() }),
    );
    // Only answers that came from TorBox are kept; a failure is retried on the next run so a fixed key shows up at once.
    this.torboxCache = check.status === 'error' ? null : { atMs: this.now(), check };
    return check;
  }

  private async ffmpeg(fresh: boolean): Promise<HealthCheck> {
    const cached = this.ffmpegCache;
    if (!fresh && cached) {
      const age = this.now() - cached.atMs;
      // The test encode uses the GPU; while a session is encoding the last result stays until the sessions end.
      if (age < FFMPEG_CACHE_MS || this.deps.playback.activity().length > 0) return cached.check;
    }
    const check = await this.measure('ffmpeg', () =>
      checkFfmpeg({ config: this.deps.config, run: this.run_, now: this.now }),
    );
    this.ffmpegCache = check.status === 'error' ? null : { atMs: this.now(), check };
    return check;
  }

  private disk(): Promise<CheckOutcome> {
    return checkDisk({ config: this.deps.config, probe: this.diskProbe, usage: () => this.deps.playback.diskUsage() });
  }

  private sessions(): CheckOutcome {
    const { db, playback } = this.deps;
    return checkSessions({
      active: () => playback.activity().length,
      fallingBehind: () => playback.fallingBehindSessions(),
      recentErrors: () => {
        const since = this.now() - RECENT_ERROR_WINDOW_MS;
        return { count: countSessionErrors(db, since), latest: recentSessionErrors(db, since) };
      },
    });
  }

  private network(): HealthCheck {
    const { config, playback, sourceProxy } = this.deps;
    const nowMs = this.now();
    const started = this.now();
    const check = buildNetworkCheck(networkSnapshot({ sourceProxy, playback }), {
      nowMs,
      latencyMs: Math.max(0, this.now() - started),
      configPath: config.configFile.path,
    });
    return redactDeep(check as HealthCheck);
  }
}
