import { restartDelaySec, SERVER_RESTART_LIMIT, type RestartResult } from '@homestream/shared';
import type { Logger } from './logger.js';
import { failureCodeFrom } from './serverLaunch.js';
import type { ExitInfo, ServerChild } from './serverProcess.js';

export type SupervisorStatus =
  | { kind: 'starting' }
  | { kind: 'running'; pid: number }
  | { kind: 'attached' }
  /** An attached server that stopped answering. The app spawns nothing on its own. */
  | { kind: 'lost' }
  | { kind: 'crashed'; attempt: number; retryAt: number }
  /** `portInUse`: another program holds the server port, so nothing was spawned (as opposed to a server that kept crashing). */
  | { kind: 'failed'; code: string; lastAttemptAt: number; portInUse?: true }
  | { kind: 'stopped' };

export interface SupervisorDeps {
  spawn(): ServerChild;
  probe(): Promise<'homestream' | 'other' | 'none'>;
  logger: Logger;
}

export interface SupervisorTiming {
  readyPollMs: number;
  readyTimeoutMs: number;
  attachPollMs: number;
  /** Consecutive failed probes before an attached server counts as gone. */
  attachMisses: number;
  crashWindowMs: number;
  stopGraceMs: number;
}

const DEFAULT_TIMING: SupervisorTiming = {
  readyPollMs: 250,
  readyTimeoutMs: 60_000,
  attachPollMs: 4000,
  attachMisses: 2,
  crashWindowMs: 60_000,
  stopGraceMs: 5000,
};

const OUTPUT_TAIL_LINES = 30;
export const EXTERNAL_SERVER_MESSAGE = 'Server is managed outside the app';

/** The one-line status `getServerStatus()` returns and Settings shows. */
export function statusText(status: SupervisorStatus): string {
  switch (status.kind) {
    case 'starting':
      return 'Server: starting';
    case 'running':
      return `Server: running (spawned, pid ${status.pid})`;
    case 'attached':
      return 'Server: attached to external server';
    case 'lost':
      return 'Server: not running \u2014 reconnecting';
    case 'crashed':
      return `Server: crashed \u2014 restarting (${status.attempt}/${SERVER_RESTART_LIMIT})`;
    case 'failed':
      return 'Server: failed \u2014 see logs';
    case 'stopped':
      return 'Server: stopped';
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Keeps the server running. It attaches to a HomeStream server that already answers, otherwise spawns one and restarts
 * it after a crash (1 s, 2 s, then 5 s apart, at most five restarts in a minute before it gives up with `failed`).
 */
export class Supervisor {
  private state: SupervisorStatus = { kind: 'starting' };
  private child: ServerChild | null = null;
  private generation = 0;
  private crashes: number[] = [];
  private tail: string[] = [];
  private restartTimer: ReturnType<typeof setTimeout> | undefined;
  private watchTimer: ReturnType<typeof setTimeout> | undefined;
  private shuttingDown = false;
  private queue: Promise<unknown> = Promise.resolve();
  private stopEpoch = 0;
  private ending: Promise<void> | null = null;
  private restarting: Promise<RestartResult> | null = null;
  private readonly listeners = new Set<(status: SupervisorStatus) => void>();

  constructor(
    private readonly deps: SupervisorDeps,
    private readonly timing: SupervisorTiming = DEFAULT_TIMING,
  ) {}

  get status(): SupervisorStatus {
    return this.state;
  }

  get text(): string {
    return statusText(this.state);
  }

  /** True while the server answers: spawned and ready, or attached. */
  get reachable(): boolean {
    return this.state.kind === 'running' || this.state.kind === 'attached';
  }

  get spawnedPid(): number | null {
    return this.state.kind === 'running' ? this.state.pid : null;
  }

  onChange(listener: (status: SupervisorStatus) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Attach to a running HomeStream server, or spawn one. */
  start(): Promise<void> {
    return this.serial(async (quit) => {
      if (!quit()) await this.begin();
    });
  }

  /** The Retry button: forget the crash history and attach or spawn again. */
  retry(): Promise<void> {
    return this.serial(async (quit) => {
      this.crashes = [];
      await this.stopChild();
      if (!quit()) await this.begin();
    });
  }

  /** Requests made while a restart is under way share it, so they cannot spawn a second server. */
  restart(): Promise<RestartResult> {
    this.restarting ??= this.serial((quit) => this.restartNow(quit)).finally(() => {
      this.restarting = null;
    });
    return this.restarting;
  }

  /** "Start server" after an attached server went away. */
  startServer(): Promise<void> {
    return this.serial(async (quit) => {
      if (quit() || this.state.kind !== 'lost') return;
      this.crashes = [];
      this.invalidate();
      this.spawnChild(this.generation);
    });
  }

  /** Quit: stop the server this app started. An attached server is left running. */
  async stop(): Promise<void> {
    this.stopEpoch += 1;
    this.shuttingDown = true;
    this.invalidate();
    await this.stopChild();
    this.set({ kind: 'stopped' });
  }

  /**
   * Start, Retry, restart and startServer run one after the other: each stops the child and then spawns or attaches
   * across awaits, and two running at once would each spawn a server. `quit()` tells a task that `stop()` was called
   * after the request was made, so it must not start anything. `stop()` itself never waits in the queue.
   */
  private serial<T>(task: (quit: () => boolean) => Promise<T>): Promise<T> {
    const epoch = this.stopEpoch;
    const run = this.queue.then(() => task(() => this.stopEpoch !== epoch));
    this.queue = Promise.allSettled([run]);
    return run;
  }

  private async begin(): Promise<void> {
    this.shuttingDown = false;
    const generation = this.invalidate();
    this.set({ kind: 'starting' });
    const answer = await this.deps.probe();
    if (!this.isCurrent(generation)) return;
    if (answer === 'homestream') {
      this.attach(generation);
    } else if (answer === 'other') {
      // A server we spawn would only fail to bind, and retrying cannot free the port.
      this.deps.logger.error('the server port is used by another program; not starting the server');
      this.set({ kind: 'failed', code: 'EADDRINUSE', lastAttemptAt: Date.now(), portInUse: true });
    } else {
      this.spawnChild(generation);
    }
  }

  private async restartNow(quit: () => boolean): Promise<RestartResult> {
    if (this.state.kind === 'attached' || this.state.kind === 'lost') {
      return { ok: false, message: EXTERNAL_SERVER_MESSAGE };
    }
    this.crashes = [];
    await this.stopChild();
    if (quit()) return { ok: true };
    this.invalidate();
    this.spawnChild(this.generation);
    return { ok: true };
  }
  private invalidate(): number {
    this.generation += 1;
    clearTimeout(this.restartTimer);
    clearTimeout(this.watchTimer);
    return this.generation;
  }

  private isCurrent(generation: number): boolean {
    return generation === this.generation && !this.shuttingDown;
  }

  private set(status: SupervisorStatus): void {
    this.state = status;
    for (const listener of this.listeners) listener(status);
  }

  private attach(generation: number): void {
    this.deps.logger.info('attached to the server that is already running');
    this.set({ kind: 'attached' });
    let misses = 0;
    const poll = async (): Promise<void> => {
      const answer = await this.deps.probe();
      if (!this.isCurrent(generation)) return;
      misses = answer === 'homestream' ? 0 : misses + 1;
      if (answer === 'homestream' && this.state.kind === 'lost') {
        this.deps.logger.info('the external server answers again');
        this.set({ kind: 'attached' });
      } else if (misses >= this.timing.attachMisses && this.state.kind === 'attached') {
        this.deps.logger.warn('the external server stopped answering');
        this.set({ kind: 'lost' });
      }
      this.watchTimer = setTimeout(() => void poll(), this.timing.attachPollMs);
    };
    this.watchTimer = setTimeout(() => void poll(), this.timing.attachPollMs);
  }

  private spawnChild(generation: number): void {
    this.tail = [];
    let child: ServerChild;
    try {
      child = this.deps.spawn();
    } catch (error) {
      this.deps.logger.error('could not start the server', { error: error instanceof Error ? error : String(error) });
      this.tail = ['ENOENT'];
      this.handleExit(null, { code: null, signal: null });
      return;
    }
    this.child = child;
    this.set({ kind: 'starting' });
    this.deps.logger.info('server process started', { pid: child.pid ?? 0 });
    child.onOutput((line, stream) => {
      this.tail.push(line);
      if (this.tail.length > OUTPUT_TAIL_LINES) this.tail.shift();
      if (stream === 'stderr') this.deps.logger.warn('server error output', { line });
    });
    child.onExit((info) => this.handleExit(child, info));
    void this.waitUntilReady(child, generation);
  }

  private async waitUntilReady(child: ServerChild, generation: number): Promise<void> {
    const deadline = Date.now() + this.timing.readyTimeoutMs;
    while (this.isCurrent(generation) && this.child === child) {
      if ((await this.deps.probe()) === 'homestream') {
        if (this.isCurrent(generation) && this.child === child && child.pid !== undefined) {
          this.deps.logger.info('server is ready', { pid: child.pid });
          this.set({ kind: 'running', pid: child.pid });
        }
        return;
      }
      if (Date.now() > deadline) {
        this.deps.logger.error('the server did not answer in time; stopping it');
        child.forceKill();
        return;
      }
      await sleep(this.timing.readyPollMs);
    }
  }

  private handleExit(child: ServerChild | null, info: ExitInfo): void {
    if (child !== null && child !== this.child) return;
    this.child = null;
    const now = Date.now();
    this.crashes = [...this.crashes.filter((at) => now - at < this.timing.crashWindowMs), now];
    const attempt = this.crashes.length;
    this.deps.logger.warn('server exited', { code: info.code ?? -1, signal: info.signal ?? '', attempt });
    if (attempt > SERVER_RESTART_LIMIT) {
      const code = failureCodeFrom(this.tail, info.code);
      this.deps.logger.error('the server keeps stopping; giving up', { code });
      this.set({ kind: 'failed', code, lastAttemptAt: now });
      return;
    }
    const delayMs = restartDelaySec(attempt) * 1000;
    this.set({ kind: 'crashed', attempt, retryAt: now + delayMs });
    const generation = this.generation;
    this.restartTimer = setTimeout(() => this.spawnChild(generation), delayMs);
  }

  /** Clean stop first (the `shutdown` line, so the mDNS goodbye is sent), then the process tree after the grace time. */
  private async stopChild(): Promise<void> {
    const child = this.child;
    if (!child) {
      // A restart may be ending the child already: Quit has to wait for it too.
      await this.ending;
      return;
    }
    this.child = null;
    this.ending = this.endChild(child);
    try {
      await this.ending;
    } finally {
      this.ending = null;
    }
  }

  private async endChild(child: ServerChild): Promise<void> {
    const exited = new Promise<void>((resolve) => child.onExit(() => resolve()));
    child.requestShutdown();
    const timedOut = await Promise.race([exited.then(() => false), sleep(this.timing.stopGraceMs).then(() => true)]);
    if (!timedOut) return;
    this.deps.logger.warn('the server did not stop in time; ending it');
    child.forceKill();
    await Promise.race([exited, sleep(2000)]);
  }
}
