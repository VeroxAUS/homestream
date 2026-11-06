import {
  coerceFlagValue,
  sanitizeEventProperties,
  type AnalyticsEventName,
  type AnalyticsProperties,
  type FlagKey,
  type FlagValue,
} from '@homestream/shared';
import { FeatureFlagsExtensions } from 'posthog-js/dist/extension-bundles';
import posthog, { type CaptureResult } from 'posthog-js/dist/module.slim';
import type { TelemetryConfig } from './config';
import { scrubUrl } from './scrub';

/** The only SDK-added properties that leave the browser. `$current_url`, `$referrer`, `$pathname` and the like are not among them. */
const KEPT_SDK_PROPERTIES = new Set(['token', 'distinct_id', '$lib', '$lib_version', '$process_person_profile']);

/**
 * `before_send` hook: drops every event that is not in the typed catalog and rebuilds the properties from the catalog
 * allow-list plus a handful of SDK fields. Exported for tests.
 */
export function restrictToCatalog(event: CaptureResult | null, appVersion: string): CaptureResult | null {
  if (!event) return null;
  const clean = sanitizeEventProperties(event.event, event.properties, scrubUrl);
  if (!clean) return null;
  const kept: Record<string, unknown> = { ...clean, app: 'web', appVersion, $geoip_disable: true };
  for (const key of KEPT_SDK_PROPERTIES) if (key in event.properties) kept[key] = event.properties[key];
  delete event.$set;
  delete event.$set_once;
  return { ...event, properties: kept };
}

/** Starts posthog-js with everything automatic switched off (flags are read, never reported on). Returns false when there is no key or starting fails. */
export function startPostHog(config: TelemetryConfig): boolean {
  if (!config.posthogKey) return false;
  try {
    posthog.init(config.posthogKey, {
      // The slim build has no flag support of its own; this is the one extension it needs.
      __extensionClasses: { ...FeatureFlagsExtensions },
      api_host: config.posthogHost,
      autocapture: false,
      capture_pageview: false,
      capture_pageleave: false,
      capture_dead_clicks: false,
      capture_heatmaps: false,
      capture_exceptions: false,
      disable_session_recording: true,
      disable_surveys: true,
      disable_web_experiments: true,
      disable_external_dependency_loading: true,
      advanced_disable_toolbar_metrics: true,
      disable_compression: true,
      save_campaign_params: false,
      save_referrer: false,
      ip: false,
      person_profiles: 'identified_only',
      persistence: 'localStorage',
      // Headless browsers are filtered as bots by default; the stub build is driven by one (Playwright).
      opt_out_useragent_filter: config.testTrigger,
      before_send: (event) => restrictToCatalog(event, config.release.replace(/^homestream@/, '')),
    });
    return true;
  } catch {
    return false;
  }
}

export function captureEvent<E extends AnalyticsEventName>(event: E, properties: AnalyticsProperties<E>): void {
  try {
    posthog.capture(event, properties);
  } catch {
    // analytics must never disturb the page
  }
}

/**
 * Calls `onValue` with the variant PostHog assigned to this install, once flags are loaded. A flag that PostHog does not
 * answer for (unreachable, not defined, unknown variant) never reaches the callback, so the local default stays.
 */
export function watchFlag<K extends FlagKey>(key: K, onValue: (value: FlagValue<K>) => void): void {
  try {
    posthog.onFeatureFlags(() => {
      const raw = posthog.getFeatureFlag(key, { send_event: false });
      if (raw !== undefined) onValue(coerceFlagValue(key, raw));
    });
    posthog.reloadFeatureFlags();
  } catch {
    // flags are optional: the default stays
  }
}
