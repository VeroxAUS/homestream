import { expect, test, type APIRequestContext } from '@playwright/test';
import pkg from '../package.json' with { type: 'json' };
import ports from './ports.json' with { type: 'json' };

const HUB = `http://127.0.0.1:${ports.sentry}`;
const ORIGIN = `http://127.0.0.1:${ports.serverStub}`;

interface SentryEvent {
  release?: string;
  environment?: string;
  tags?: Record<string, string>;
  user?: unknown;
  request?: unknown;
  server_name?: string;
  breadcrumbs?: Array<{ category?: string; message?: string; data?: Record<string, unknown> }>;
  exception?: { values?: Array<{ stacktrace?: { frames?: Array<{ filename?: string }> } }> };
}
interface PostHogEvent {
  event: string;
  properties: Record<string, unknown>;
}
interface Captured {
  sentry: SentryEvent[];
  posthog: PostHogEvent[];
}

async function captured(request: APIRequestContext): Promise<Captured> {
  return (await (await request.get(`${HUB}/__captured`)).json()) as Captured;
}

test.beforeEach(async ({ request }) => {
  await request.delete(`${HUB}/__captured`);
});

test.describe('web telemetry (stub build pointing at local receivers)', () => {
  test('a deliberate error arrives scrubbed, with release, environment, tags and breadcrumbs', async ({
    page,
    request,
  }) => {
    const runId = `e2e-${Date.now()}`;
    await page.goto(`/?__telemetry_test=${runId}&secret=do-not-send`);
    await expect(page.getByRole('status')).toContainText('Server:');

    await expect.poll(async () => (await captured(request)).sentry.length, { timeout: 15_000 }).toBeGreaterThan(0);
    const { sentry } = await captured(request);
    const event = sentry.find((item) => item.tags?.telemetry_test_run === runId);
    expect(event).toBeDefined();
    expect(event?.release).toBe(`homestream@${pkg.version}`);
    expect(event?.environment).toBe('e2e');
    expect(event?.tags).toMatchObject({ app: 'web', process: 'renderer', 'device.kind': 'web', route: '/' });
    expect(JSON.stringify(event?.user ?? {})).not.toMatch(/ip_address|"id"|email|username/);
    expect(event?.request).toBeUndefined();
    expect(event?.server_name).toBeUndefined();
    expect(event?.breadcrumbs?.some((crumb) => crumb.message?.includes('/api/info'))).toBe(true);

    const text = JSON.stringify(event);
    expect(text).not.toContain('do-not-send');
    expect(text).not.toContain(ORIGIN);
    const frames = event?.exception?.values?.flatMap((value) => value.stacktrace?.frames ?? []) ?? [];
    expect(frames.length).toBeGreaterThan(0);
    for (const frame of frames) expect(frame.filename).toMatch(/^app:\/\/\//);
  });

  test('reports a page view as the catalog event with the route template, and nothing automatic', async ({
    page,
    request,
  }) => {
    await page.goto('/?utm_source=private');
    await expect(page.getByRole('status')).toContainText('Server:');

    await expect.poll(async () => (await captured(request)).posthog.length, { timeout: 15_000 }).toBeGreaterThan(0);
    await page.click('body');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(1500);
    const { posthog } = await captured(request);
    expect(posthog.map((event) => event.event)).toEqual(['page_viewed']);
    expect(posthog[0]?.properties).toMatchObject({ route: '/', deviceKind: 'web', app: 'web', $geoip_disable: true });
    const text = JSON.stringify(posthog);
    expect(text).not.toContain('private');
    expect(text).not.toContain('127.0.0.1');
    expect(posthog[0]?.properties).not.toHaveProperty('$current_url');
  });

  test('sends no error report when nothing went wrong', async ({ page, request }) => {
    await page.goto('/');
    await expect(page.getByRole('status')).toContainText('Server:');
    await expect.poll(async () => (await captured(request)).posthog.length, { timeout: 15_000 }).toBeGreaterThan(0);
    expect((await captured(request)).sentry).toEqual([]);
  });

  test('a browser that opted out sends nothing, even with the test trigger', async ({ page, request }) => {
    await page.addInitScript(() => localStorage.setItem('homestream.telemetry', 'off'));
    await page.goto('/?__telemetry_test=e2e-opt-out');
    await expect(page.getByRole('status')).toContainText('Server:');
    await page.waitForTimeout(3000);
    const data = await captured(request);
    expect(data.sentry).toEqual([]);
    expect(data.posthog).toEqual([]);
  });
});
