import {
  sanitizeEventProperties,
  type AnalyticsEventName,
  type AnalyticsProperties,
  type TextScrubber,
} from '@homestream/shared';
import { PostHog, type PostHogOptions } from 'posthog-node';

type PostHogFetch = NonNullable<PostHogOptions['fetch']>;
type PostHogFetchResult = Awaited<ReturnType<PostHogFetch>>;

const REQUEST_TIMEOUT_MS = 5000;
const FLAG_TIMEOUT_MS = 2000;

export interface PostHogSetup {
  apiKey: string;
  host: string;
  /** Random install id; the only identity an event carries. */
  distinctId: string;
  appVersion: string;
  scrub: TextScrubber;
  /** Called with a one-line description of every request the client makes; the key is never part of it. */
  onRequest?: (description: string) => void;
  /** Queue size that triggers an immediate send (tests lower it). */
  flushAt?: number;
}

/** Typed, sanitizing front for posthog-node: no autocapture, no person profiles, no GeoIP, no flag-call events. */
export class AnalyticsClient {
  private readonly client: PostHog;

  constructor(private readonly setup: PostHogSetup) {
    this.client = new PostHog(setup.apiKey, {
      host: setup.host,
      flushAt: setup.flushAt ?? 20,
      flushInterval: 10_000,
      requestTimeout: REQUEST_TIMEOUT_MS,
      featureFlagsRequestTimeoutMs: FLAG_TIMEOUT_MS,
      fetchRetryCount: 1,
      disableGeoip: true,
      disableCompression: true,
      disableRemoteConfig: true,
      preloadFeatureFlags: false,
      sendFeatureFlagEvent: false,
      enableExceptionAutocapture: false,
      ...(setup.onRequest ? { fetch: this.describedFetch(setup.onRequest) } : {}),
    });
    this.client.on('error', () => undefined);
  }

  capture<E extends AnalyticsEventName>(event: E, properties: AnalyticsProperties<E>): void {
    const clean = sanitizeEventProperties(event, properties, this.setup.scrub);
    if (!clean) return;
    this.client.capture({
      distinctId: this.setup.distinctId,
      event,
      properties: { ...clean, app: 'server', appVersion: this.setup.appVersion, $process_person_profile: false },
      disableGeoip: true,
    });
  }

  /** PostHog's answer for a flag: a boolean, a variant name, or undefined when it is unknown or unreachable. */
  async flagValue(key: string): Promise<boolean | string | undefined> {
    const flags = await this.client.evaluateFlags(this.setup.distinctId, { flagKeys: [key], disableGeoip: true });
    return flags.getFlag(key);
  }
  async shutdown(timeoutMs: number): Promise<void> {
    try {
      await this.client.shutdown(timeoutMs);
    } catch {
      // shutting down anyway
    }
  }

  private describedFetch(report: (description: string) => void): PostHogFetch {
    return async (url, init) => {
      const path = new URL(url).pathname;
      try {
        const response = await fetch(url, init as RequestInit);
        report(`${init.method ?? 'GET'} ${path} -> ${response.status}`);
        return response as unknown as PostHogFetchResult;
      } catch (error) {
        report(`${init.method ?? 'GET'} ${path} -> failed (${error instanceof Error ? error.name : 'error'})`);
        throw error;
      }
    };
  }
}
