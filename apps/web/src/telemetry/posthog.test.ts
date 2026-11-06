import type { CaptureResult } from 'posthog-js/dist/module.slim';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TelemetryConfig } from './config';

const sdk = vi.hoisted(() => ({ init: vi.fn(), capture: vi.fn() }));
vi.mock('posthog-js/dist/module.slim', () => ({ default: sdk }));

const { captureEvent, restrictToCatalog, startPostHog } = await import('./posthog');

const CONFIG: TelemetryConfig = {
  sentryDsn: null,
  posthogKey: 'phc_example',
  posthogHost: 'http://127.0.0.1:9',
  release: 'homestream@1.2.3',
  environment: 'production',
  testTrigger: false,
};

function event(name: string, properties: Record<string, unknown>): CaptureResult {
  return {
    uuid: 'u',
    event: name,
    properties,
    $set: { email: 'a@example.test' },
    timestamp: new Date(),
  } as CaptureResult;
}

describe('restrictToCatalog', () => {
  it('passes a catalog event and drops every property outside the allow-list', () => {
    const result = restrictToCatalog(
      event('page_viewed', {
        route: '/movie/:id',
        deviceKind: 'web',
        $current_url: 'http://192.168.1.50:8600/movie/603?token=abc',
        $referrer: 'http://example.test/',
        distinct_id: 'install-1',
        token: 'phc_example',
        title: 'Private movie',
      }),
      '1.2.3',
    );
    expect(result?.properties).toEqual({
      route: '/movie/:id',
      deviceKind: 'web',
      app: 'web',
      appVersion: '1.2.3',
      $geoip_disable: true,
      distinct_id: 'install-1',
      token: 'phc_example',
    });
    expect(result?.$set).toBeUndefined();
  });

  it('drops events that are not in the catalog, including SDK automatic ones', () => {
    expect(restrictToCatalog(event('$pageview', { $current_url: 'http://example.test/' }), '1.2.3')).toBeNull();
    expect(restrictToCatalog(event('$autocapture', {}), '1.2.3')).toBeNull();
    expect(restrictToCatalog(event('made_up', {}), '1.2.3')).toBeNull();
  });

  it('drops a property that does not fit its schema, such as a real path instead of a route template', () => {
    const result = restrictToCatalog(event('page_viewed', { route: '/movie/603', deviceKind: 'web' }), '1.2.3');
    expect(result?.properties).not.toHaveProperty('route');
    expect(JSON.stringify(result)).not.toContain('603');
  });

  it('passes null through', () => {
    expect(restrictToCatalog(null, '1.2.3')).toBeNull();
  });
});

describe('startPostHog', () => {
  beforeEach(() => {
    sdk.init.mockReset();
    sdk.capture.mockReset();
  });

  it('does nothing without a key', () => {
    expect(startPostHog({ ...CONFIG, posthogKey: null })).toBe(false);
    expect(sdk.init).not.toHaveBeenCalled();
  });

  it('starts with every automatic feature off and identified-only profiles', () => {
    expect(startPostHog(CONFIG)).toBe(true);
    const [key, options] = sdk.init.mock.calls[0] as [string, Record<string, unknown>];
    expect(key).toBe('phc_example');
    expect(options).toMatchObject({
      api_host: 'http://127.0.0.1:9',
      autocapture: false,
      capture_pageview: false,
      capture_pageleave: false,
      disable_session_recording: true,
      disable_surveys: true,
      capture_exceptions: false,
      person_profiles: 'identified_only',
      ip: false,
    });
    expect(options.before_send).toBeTypeOf('function');
  });

  it('reports false when the SDK throws', () => {
    sdk.init.mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(startPostHog(CONFIG)).toBe(false);
  });

  it('hands only catalog events through the before_send hook of the SDK', () => {
    startPostHog(CONFIG);
    const hook = (
      sdk.init.mock.calls[0] as [string, { before_send: (e: CaptureResult | null) => CaptureResult | null }]
    )[1].before_send;
    expect(hook(event('page_viewed', { route: '/', deviceKind: 'web' }))?.properties).toMatchObject({
      appVersion: '1.2.3',
    });
    expect(hook(event('$pageview', {}))).toBeNull();
  });
});

describe('captureEvent', () => {
  it('forwards the event and never throws', () => {
    captureEvent('page_viewed', { route: '/', deviceKind: 'web' });
    expect(sdk.capture).toHaveBeenCalledWith('page_viewed', { route: '/', deviceKind: 'web' });
    sdk.capture.mockImplementation(() => {
      throw new Error('boom');
    });
    expect(() => captureEvent('page_viewed', { route: '/', deviceKind: 'web' })).not.toThrow();
  });
});
