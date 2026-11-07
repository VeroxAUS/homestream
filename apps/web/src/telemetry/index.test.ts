import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OPT_OUT_KEY, type RawTelemetryConfig } from './config';

const runtime = vi.hoisted(() => ({
  startTelemetry: vi.fn(),
  runTestTrigger: vi.fn(),
  recordPageView: vi.fn(),
  recordRenderError: vi.fn(),
}));
vi.mock('./runtime', () => runtime);

const KEYED: RawTelemetryConfig = {
  sentryDsn: 'https://public@sentry.example.test/1',
  posthogKey: 'phc_example',
  posthogHost: null,
  off: false,
  stub: false,
  release: 'homestream@1.2.3',
  environment: 'production',
};
const NO_KEYS: RawTelemetryConfig = { ...KEYED, sentryDsn: null, posthogKey: null };

async function freshIndex() {
  vi.resetModules();
  return import('./index');
}

async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(10_000);
}

describe('telemetry loader', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    performance.clearMarks();
    localStorage.clear();
    for (const mock of Object.values(runtime)) mock.mockClear();
  });
  afterEach(() => vi.useRealTimers());

  it('does nothing at all without keys: no runtime chunk, no page view', async () => {
    const { startTelemetryWhenIdle, trackPageView } = await freshIndex();
    startTelemetryWhenIdle(NO_KEYS);
    trackPageView('/');
    await settle();
    expect(runtime.startTelemetry).not.toHaveBeenCalled();
    expect(runtime.recordPageView).not.toHaveBeenCalled();
  });

  it('does nothing when the build said off', async () => {
    const { startTelemetryWhenIdle } = await freshIndex();
    startTelemetryWhenIdle({ ...KEYED, off: true });
    await settle();
    expect(runtime.startTelemetry).not.toHaveBeenCalled();
  });

  it('does nothing when the browser opted out', async () => {
    localStorage.setItem(OPT_OUT_KEY, 'off');
    const { startTelemetryWhenIdle } = await freshIndex();
    startTelemetryWhenIdle(KEYED);
    await settle();
    expect(runtime.startTelemetry).not.toHaveBeenCalled();
  });

  it('waits for the home content mark before it loads the runtime', async () => {
    const { HOME_CONTENT_MARK, startTelemetryWhenIdle } = await freshIndex();
    startTelemetryWhenIdle(KEYED);
    await vi.advanceTimersByTimeAsync(2000);
    expect(runtime.startTelemetry).not.toHaveBeenCalled();
    performance.mark(HOME_CONTENT_MARK);
    await settle();
    expect(runtime.startTelemetry).toHaveBeenCalledTimes(1);
    expect(runtime.startTelemetry).toHaveBeenCalledWith(expect.objectContaining({ sentryDsn: KEYED.sentryDsn }));
    expect(runtime.runTestTrigger).toHaveBeenCalledWith(window.location.search);
  });

  it('starts as soon as the mark is made, without waiting for the limit', async () => {
    vi.useRealTimers();
    const { HOME_CONTENT_MARK, startTelemetryWhenIdle } = await freshIndex();
    startTelemetryWhenIdle(KEYED);
    performance.mark(HOME_CONTENT_MARK);
    await vi.waitFor(() => expect(runtime.startTelemetry).toHaveBeenCalledTimes(1), { timeout: 2000 });
  });

  it('works when the browser denies access to localStorage', async () => {
    const denied = vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new Error('denied');
    });
    const { HOME_CONTENT_MARK, startTelemetryWhenIdle } = await freshIndex();
    performance.mark(HOME_CONTENT_MARK);
    startTelemetryWhenIdle(KEYED);
    await settle();
    denied.mockRestore();
    expect(runtime.startTelemetry).toHaveBeenCalledTimes(1);
  });

  it('uses the idle callback when the browser has one', async () => {
    const idle = vi.fn((callback: () => void) => setTimeout(callback, 50));
    vi.stubGlobal('requestIdleCallback', idle);
    const { HOME_CONTENT_MARK, startTelemetryWhenIdle } = await freshIndex();
    performance.mark(HOME_CONTENT_MARK);
    startTelemetryWhenIdle(KEYED);
    await settle();
    vi.unstubAllGlobals();
    expect(idle).toHaveBeenCalledWith(expect.any(Function), { timeout: 3000 });
    expect(runtime.startTelemetry).toHaveBeenCalledTimes(1);
  });

  it('starts anyway after the wait limit when the mark never comes', async () => {
    const { startTelemetryWhenIdle } = await freshIndex();
    startTelemetryWhenIdle(KEYED);
    await settle();
    expect(runtime.startTelemetry).toHaveBeenCalledTimes(1);
  });

  it('starts at once when the mark is already there, and only starts once', async () => {
    const { HOME_CONTENT_MARK, startTelemetryWhenIdle } = await freshIndex();
    performance.mark(HOME_CONTENT_MARK);
    startTelemetryWhenIdle(KEYED);
    startTelemetryWhenIdle(KEYED);
    await settle();
    expect(runtime.startTelemetry).toHaveBeenCalledTimes(1);
  });

  it('reports each route template once and never the real path', async () => {
    const { HOME_CONTENT_MARK, startTelemetryWhenIdle, trackPageView } = await freshIndex();
    performance.mark(HOME_CONTENT_MARK);
    startTelemetryWhenIdle(KEYED);
    trackPageView('/movie/603');
    trackPageView('/movie/603');
    trackPageView('/tv/1399');
    await settle();
    expect(runtime.recordPageView.mock.calls).toEqual([['/movie/:id'], ['/tv/:id']]);
  });

  it('survives a runtime chunk that fails to load', async () => {
    runtime.startTelemetry.mockImplementationOnce(() => {
      throw new Error('chunk failed');
    });
    const { HOME_CONTENT_MARK, startTelemetryWhenIdle, trackPageView } = await freshIndex();
    performance.mark(HOME_CONTENT_MARK);
    startTelemetryWhenIdle(KEYED);
    trackPageView('/');
    await settle();
    expect(runtime.recordPageView).not.toHaveBeenCalled();
  });

  it('reports a caught render error once per error, also when it arrives before the runtime has loaded', async () => {
    const { startTelemetryWhenIdle, reportRenderError } = await freshIndex();
    startTelemetryWhenIdle(KEYED);
    const error = new Error('render failed');
    reportRenderError(error, 'route');
    reportRenderError(error, 'app');
    expect(runtime.recordRenderError).not.toHaveBeenCalled();
    await settle();
    expect(runtime.recordRenderError).toHaveBeenCalledExactlyOnceWith(error, 'route');
  });

  it('reports nothing for a render error without keys, and survives a runtime that failed to load', async () => {
    const off = await freshIndex();
    off.startTelemetryWhenIdle(NO_KEYS);
    off.reportRenderError(new Error('render failed'), 'app');
    await settle();
    expect(runtime.recordRenderError).not.toHaveBeenCalled();

    runtime.startTelemetry.mockImplementationOnce(() => {
      throw new Error('chunk failed');
    });
    const failed = await freshIndex();
    failed.startTelemetryWhenIdle(KEYED);
    failed.reportRenderError('not an object', 'app');
    await settle();
    expect(runtime.recordRenderError).not.toHaveBeenCalled();
  });
});
