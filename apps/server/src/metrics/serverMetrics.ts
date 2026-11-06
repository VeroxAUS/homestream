import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';
import type { RestartReason } from '../playback/observer.js';

/** Everything the scrape reads on demand from the running services, so the hot paths only bump plain integers. */
export interface MetricSources {
  activeSessions(): number;
  encoderSpeeds(): number[];
  gateway(): { requests: number; errors: number; cacheHits: number; cacheMisses: number };
  tmdb(): { requests: number; errors: number; cacheHits: number; cacheMisses: number };
  proxyCache(): { hits: number; misses: number; bytes: number };
}

const DURATION_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30];

/** Routes whose traffic is not counted per request: segment serving and the endpoints that watch the server itself. */
const UNINSTRUMENTED = [/^\/hls\//, /^\/metrics$/, /^\/healthz$/, /^\/readyz$/, /^\/api\/events$/];

export function isInstrumentedPath(pathname: string): boolean {
  return !UNINSTRUMENTED.some((pattern) => pattern.test(pathname));
}

function safeLabel(value: string): string {
  return /^[a-z0-9_]{1,48}$/.test(value) ? value : 'other';
}

/**
 * Prometheus registry of one server instance. Label values are always route templates, status codes or short fixed codes:
 * never ids, URLs, hosts or secrets.
 */
export class ServerMetrics {
  readonly registry = new Registry();
  private readonly requests: Counter<'method' | 'route' | 'status'>;
  private readonly duration: Histogram<'method' | 'route' | 'status'>;
  private readonly sessionsStarted: Counter;
  private readonly sessionsFailed: Counter<'stage' | 'code'>;
  private readonly encoderRestarts: Counter<'reason'>;
  private defaultMetricsStarted = false;
  private sources: MetricSources | null = null;

  constructor() {
    const { registry } = this;
    this.requests = new Counter({
      name: 'homestream_http_requests_total',
      help: 'HTTP requests handled, by method, route template and status.',
      labelNames: ['method', 'route', 'status'],
      registers: [registry],
    });
    this.duration = new Histogram({
      name: 'homestream_http_request_duration_seconds',
      help: 'HTTP request duration in seconds, by method, route template and status.',
      labelNames: ['method', 'route', 'status'],
      buckets: DURATION_BUCKETS,
      registers: [registry],
    });
    this.sessionsStarted = new Counter({
      name: 'homestream_sessions_started_total',
      help: 'Playback sessions that produced their first segment.',
      registers: [registry],
    });
    this.sessionsFailed = new Counter({
      name: 'homestream_sessions_failed_total',
      help: 'Playback sessions that failed to start or whose encoder failed while playing.',
      labelNames: ['stage', 'code'],
      registers: [registry],
    });
    this.encoderRestarts = new Counter({
      name: 'homestream_encoder_restarts_total',
      help: 'Encoder restarts (retry after a failure, seek, track change, resume).',
      labelNames: ['reason'],
      registers: [registry],
    });
    this.registerPulled();
  }

  /** Called once the services exist; scrapes read their counters through these callbacks. */
  attach(sources: MetricSources): void {
    this.sources = sources;
  }

  /** Process metrics (CPU, memory, event loop lag, GC). Started once and kept apart because each start adds observers. */
  startDefaultMetrics(): void {
    if (this.defaultMetricsStarted) return;
    this.defaultMetricsStarted = true;
    collectDefaultMetrics({ register: this.registry });
  }

  observeRequest(method: string, route: string, status: number, seconds: number): void {
    const labels = { method, route, status: String(status) };
    this.requests.inc(labels);
    this.duration.observe(labels, seconds);
  }

  sessionStarted(): void {
    this.sessionsStarted.inc();
  }

  sessionFailed(stage: 'start' | 'running', code: string): void {
    this.sessionsFailed.inc({ stage, code: safeLabel(code) });
  }

  encoderRestarted(reason: RestartReason): void {
    this.encoderRestarts.inc({ reason });
  }

  async render(): Promise<string> {
    this.startDefaultMetrics();
    return this.registry.metrics();
  }

  get contentType(): string {
    return this.registry.contentType;
  }

  /** A counter fed by a service-owned total: each scrape adds what grew since the previous one. */
  private pulledCounter(name: string, help: string, read: () => number | undefined): void {
    let last = 0;
    new Counter({
      name,
      help,
      registers: [this.registry],
      collect() {
        const total = read();
        if (total === undefined || total < last) return;
        this.inc(total - last);
        last = total;
      },
    });
  }

  private pulledGauge(name: string, help: string, read: () => number | undefined): void {
    new Gauge({
      name,
      help,
      registers: [this.registry],
      collect() {
        this.set(read() ?? 0);
      },
    });
  }

  private registerPulled(): void {
    const speeds = () => this.sources?.encoderSpeeds() ?? [];
    this.pulledGauge('homestream_sessions_active', 'Playback sessions that are live right now.', () =>
      this.sources?.activeSessions(),
    );
    this.pulledGauge(
      'homestream_encoder_speed_avg',
      'Average encoder speed of live sessions (1 is real time); 0 when idle.',
      () => {
        const all = speeds();
        return all.length === 0 ? 0 : all.reduce((sum, speed) => sum + speed, 0) / all.length;
      },
    );
    this.pulledGauge('homestream_encoder_speed_min', 'Slowest encoder speed of live sessions; 0 when idle.', () =>
      speeds().length === 0 ? 0 : Math.min(...speeds()),
    );
    this.pulledGauge(
      'homestream_sourceproxy_cache_bytes',
      'Bytes held by the source proxy block cache.',
      () => this.sources?.proxyCache().bytes,
    );
    this.pulledCounter(
      'homestream_gateway_requests_total',
      'Stream lookups sent to the gateway.',
      () => this.sources?.gateway().requests,
    );
    this.pulledCounter(
      'homestream_gateway_errors_total',
      'Gateway lookups that failed.',
      () => this.sources?.gateway().errors,
    );
    this.pulledCounter(
      'homestream_gateway_cache_hits_total',
      'Gateway lookups answered from the cache.',
      () => this.sources?.gateway().cacheHits,
    );
    this.pulledCounter(
      'homestream_gateway_cache_misses_total',
      'Gateway lookups that needed a request.',
      () => this.sources?.gateway().cacheMisses,
    );
    this.pulledCounter('homestream_tmdb_requests_total', 'Requests sent to TMDB.', () => this.sources?.tmdb().requests);
    this.pulledCounter('homestream_tmdb_errors_total', 'TMDB requests that failed.', () => this.sources?.tmdb().errors);
    this.pulledCounter(
      'homestream_tmdb_cache_hits_total',
      'TMDB lookups answered from the cache.',
      () => this.sources?.tmdb().cacheHits,
    );
    this.pulledCounter(
      'homestream_tmdb_cache_misses_total',
      'TMDB lookups that needed a request.',
      () => this.sources?.tmdb().cacheMisses,
    );
    this.pulledCounter(
      'homestream_sourceproxy_cache_hits_total',
      'Source proxy reads served from the block cache.',
      () => this.sources?.proxyCache().hits,
    );
    this.pulledCounter(
      'homestream_sourceproxy_cache_misses_total',
      'Source proxy reads that went to the CDN.',
      () => this.sources?.proxyCache().misses,
    );
  }
}
