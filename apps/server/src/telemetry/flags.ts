import { coerceFlagValue, flagDefault, type FlagKey, type FlagValue } from '@homestream/shared';

/** A flag value is re-read this often; between reads the cached answer is used and nothing waits. */
const FRESH_MS = 5 * 60_000;
/** The very first read of a flag waits at most this long for PostHog before using the default. */
const FIRST_READ_BUDGET_MS = 250;

export interface FlagSource {
  flagValue(key: string): Promise<boolean | string | undefined>;
}

export interface FlagLog {
  debug(fields: object, message: string): void;
}

interface Cached {
  value: unknown;
  at: number;
}

/**
 * Reads flags through PostHog with the local default as the fallback. A request never waits more than the first-read budget,
 * a failing or unreachable PostHog yields the default, and nothing here throws.
 */
export class FlagService {
  private readonly cache = new Map<FlagKey, Cached>();
  private readonly inflight = new Map<FlagKey, Promise<void>>();

  constructor(
    private readonly source: FlagSource | null,
    private readonly log: FlagLog,
    private readonly now: () => number = Date.now,
  ) {}

  async get<K extends FlagKey>(key: K): Promise<FlagValue<K>> {
    if (!this.source) return this.fromDefault(key, 'telemetry off');
    const cached = this.cache.get(key);
    if (cached) {
      if (this.now() - cached.at >= FRESH_MS) void this.refresh(key);
      return cached.value as FlagValue<K>;
    }
    await this.firstRead(key);
    const loaded = this.cache.get(key);
    return loaded ? (loaded.value as FlagValue<K>) : this.fromDefault(key, 'not loaded yet');
  }

  private fromDefault<K extends FlagKey>(key: K, why: string): FlagValue<K> {
    this.log.debug({ flag: key, source: 'default', why }, 'Feature flag evaluated');
    return flagDefault(key);
  }

  private async firstRead(key: FlagKey): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    const budget = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, FIRST_READ_BUDGET_MS);
      timer.unref();
    });
    try {
      await Promise.race([this.refresh(key), budget]);
    } finally {
      clearTimeout(timer);
    }
  }

  private refresh(key: FlagKey): Promise<void> {
    const running = this.inflight.get(key);
    if (running) return running;
    const task = this.load(key).finally(() => this.inflight.delete(key));
    this.inflight.set(key, task);
    return task;
  }

  private async load(key: FlagKey): Promise<void> {
    try {
      const raw = await this.source?.flagValue(key);
      // Unknown to PostHog (not created yet) or an error inside the SDK: keep the default and try again later.
      const value = raw === undefined ? flagDefault(key) : coerceFlagValue(key, raw);
      this.cache.set(key, { value, at: this.now() });
      this.log.debug({ flag: key, source: raw === undefined ? 'default' : 'posthog', value }, 'Feature flag evaluated');
    } catch {
      this.cache.set(key, { value: flagDefault(key), at: this.now() });
      this.log.debug({ flag: key, source: 'default', why: 'evaluation failed' }, 'Feature flag evaluated');
    }
  }
}
