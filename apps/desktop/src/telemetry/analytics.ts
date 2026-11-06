import {
  sanitizeEventProperties,
  type AnalyticsEventName,
  type AnalyticsProperties,
  type TextScrubber,
} from '@homestream/shared';
import { PostHog } from 'posthog-node';
import type { DesktopTelemetryConfig } from './config.js';

export interface DesktopAnalyticsSetup {
  config: DesktopTelemetryConfig;
  version: string;
  /** Random install id kept in the user-data directory by the shell; the only identity an event has. */
  distinctId: string;
  scrub: TextScrubber;
}

/** Typed front for posthog-node in the main process: catalog events only, no person profiles, no GeoIP. */
export class DesktopAnalytics {
  private readonly client: PostHog;

  constructor(private readonly setup: DesktopAnalyticsSetup & { apiKey: string }) {
    this.client = new PostHog(setup.apiKey, {
      host: setup.config.posthogHost,
      flushAt: 10,
      flushInterval: 10_000,
      requestTimeout: 5000,
      fetchRetryCount: 1,
      disableGeoip: true,
      disableRemoteConfig: true,
      preloadFeatureFlags: false,
      sendFeatureFlagEvent: false,
      enableExceptionAutocapture: false,
    });
    this.client.on('error', () => undefined);
  }

  capture<E extends AnalyticsEventName>(event: E, properties: AnalyticsProperties<E>): void {
    try {
      const clean = sanitizeEventProperties(event, properties, this.setup.scrub);
      if (!clean) return;
      this.client.capture({
        distinctId: this.setup.distinctId,
        event,
        properties: { ...clean, app: 'desktop', appVersion: this.setup.version, $process_person_profile: false },
        disableGeoip: true,
      });
    } catch {
      // analytics must never disturb the caller
    }
  }

  async shutdown(timeoutMs: number): Promise<void> {
    try {
      await this.client.shutdown(timeoutMs);
    } catch {
      // shutting down anyway
    }
  }
}

/** The analytics client, or null when the key is missing or `HOMESTREAM_TELEMETRY=off`. */
export function createDesktopAnalytics(setup: DesktopAnalyticsSetup): DesktopAnalytics | null {
  const apiKey = setup.config.disabled ? null : setup.config.posthogKey;
  if (!apiKey) return null;
  try {
    return new DesktopAnalytics({ ...setup, apiKey });
  } catch {
    return null;
  }
}
