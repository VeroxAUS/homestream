import {
  ActivityLiteSchema,
  SessionLiteSchema,
  DownloadEventSchema,
  DownloadFailedEventSchema,
  HealthResponseSchema,
  type DownloadEvent,
  type SessionLite,
  type DownloadFailedEvent,
  type HealthResponse,
} from '@homestream/shared';
import type { Logger } from './logger.js';
import type { ServerClient } from './serverHttp.js';
import { createSseParser, type SseMessage } from './sse.js';

export interface MonitorEvents {
  onHealth(health: HealthResponse): void;
  /** The number of sessions that are active on any device. */
  onSessions(count: number): void;
  onSessionError(session: SessionLite): void;
  onDownloadReady(event: DownloadEvent): void;
  onDownloadFailed(event: DownloadFailedEvent): void;
}

export interface MonitorTiming {
  healthMs: number;
  reconnectMs: number;
}

const DEFAULT_MONITOR_TIMING: MonitorTiming = { healthMs: 60_000, reconnectMs: 3000 };

/**
 * The only thing the main process reads from the server after start-up: the `/api/events` stream (health changes,
 * sessions, downloads), one `/api/activity` read per connection for the session count, and `/api/health` at most once
 * a minute. There is no other polling.
 */
export class ServerMonitor {
  private abort: AbortController | null = null;
  private healthTimer: ReturnType<typeof setInterval> | undefined;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private sessions = new Set<string>();
  private errored = new Set<string>();
  private lastHealthAt = 0;

  constructor(
    private readonly client: ServerClient,
    private readonly events: MonitorEvents,
    private readonly logger: Logger,
    private readonly timing: MonitorTiming = DEFAULT_MONITOR_TIMING,
  ) {}

  get running(): boolean {
    return this.abort !== null;
  }

  start(): void {
    if (this.abort) return;
    this.abort = new AbortController();
    this.lastHealthAt = 0;
    void this.connect(this.abort);
    void this.refreshHealth();
    this.healthTimer = setInterval(() => void this.refreshHealth(), this.timing.healthMs);
  }

  stop(): void {
    this.abort?.abort();
    this.abort = null;
    clearInterval(this.healthTimer);
    clearTimeout(this.reconnectTimer);
    this.sessions.clear();
    this.errored.clear();
    this.events.onSessions(0);
  }

  private async refreshHealth(): Promise<void> {
    const now = Date.now();
    if (now - this.lastHealthAt < this.timing.healthMs / 2) return;
    this.lastHealthAt = now;
    try {
      this.events.onHealth(HealthResponseSchema.parse(await this.client.getJson('/api/health', 15_000)));
    } catch {
      this.logger.warn('could not read the server health');
    }
  }

  private async connect(abort: AbortController): Promise<void> {
    try {
      const response = await this.client.fetch('/api/events', {
        headers: { Accept: 'text/event-stream' },
        signal: abort.signal,
      });
      if (!response.ok || !response.body) throw new Error(`event stream answered ${response.status}`);
      void this.loadActivity(abort);
      const parse = createSseParser((message) => this.handle(message));
      const decoder = new TextDecoder();
      const reader = response.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        parse(decoder.decode(value, { stream: true }));
      }
    } catch (error) {
      if (abort.signal.aborted) return;
      this.logger.warn('the event stream stopped', { error: error instanceof Error ? error : String(error) });
    }
    if (abort.signal.aborted || this.abort !== abort) return;
    this.reconnectTimer = setTimeout(() => {
      if (this.abort === abort) void this.connect(abort);
    }, this.timing.reconnectMs);
  }

  private async loadActivity(abort: AbortController): Promise<void> {
    try {
      const activity = ActivityLiteSchema.parse(await this.client.getJson('/api/activity'));
      if (abort.signal.aborted) return;
      this.sessions = new Set(activity.sessions.map((session) => session.sessionId));
      this.events.onSessions(this.sessions.size);
    } catch {
      this.logger.warn('could not read the active sessions');
    }
  }

  private handle(message: SseMessage): void {
    let payload: unknown;
    try {
      payload = JSON.parse(message.data);
    } catch {
      return;
    }
    switch (message.event) {
      case 'health':
        this.parsed(HealthResponseSchema, payload, (health) => {
          this.lastHealthAt = Date.now();
          this.events.onHealth(health);
        });
        break;
      case 'session.start':
        this.parsed(SessionLiteSchema, payload, (session) => this.addSession(session.sessionId));
        break;
      case 'session.update':
        this.parsed(SessionLiteSchema, payload, (session) => this.updateSession(session));
        break;
      case 'session.end':
        this.endSession((payload as { sessionId?: unknown }).sessionId);
        break;
      case 'download.ready':
        this.parsed(DownloadEventSchema, payload, (event) => this.events.onDownloadReady(event));
        break;
      case 'download.failed':
        this.parsed(DownloadFailedEventSchema, payload, (event) => this.events.onDownloadFailed(event));
        break;
      default:
    }
  }

  private parsed<T>(
    schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } },
    payload: unknown,
    use: (value: T) => void,
  ): void {
    const result = schema.safeParse(payload);
    if (result.success) use(result.data);
  }

  private addSession(id: string): void {
    if (this.sessions.has(id)) return;
    this.sessions.add(id);
    this.events.onSessions(this.sessions.size);
  }

  private updateSession(session: SessionLite): void {
    if (session.state === 'stopped') return this.endSession(session.sessionId);
    this.addSession(session.sessionId);
    if (session.state !== 'error' || this.errored.has(session.sessionId)) return;
    this.errored.add(session.sessionId);
    this.events.onSessionError(session);
  }

  private endSession(id: unknown): void {
    if (typeof id !== 'string') return;
    this.errored.delete(id);
    if (this.sessions.delete(id)) this.events.onSessions(this.sessions.size);
  }
}
