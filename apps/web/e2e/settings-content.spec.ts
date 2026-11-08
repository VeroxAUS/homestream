import { expect, test } from '@playwright/test';
import ports from './ports.json' with { type: 'json' };
import { BRIDGE_VERSION, installDesktopBridge } from './support/desktopBridge';
import {
  DESKTOP_LABELS,
  READ_ONLY_TEXT,
  aboutPanel,
  group,
  hash,
  info,
  rect,
  settingsPanel,
  tab,
  token,
} from './support/settingsPage';

test.describe('Settings tab and About tab content', () => {
  test('hold only the This device controls in cards on the Settings tab', async ({ page }) => {
    await page.goto('/settings');
    const panel = settingsPanel(page);
    await expect(panel.getByRole('heading')).toHaveText(['This device']);
    const card = panel.getByRole('region', { name: 'This device' }).locator(':scope > div');
    const style = await card.evaluate((element) => {
      const css = getComputedStyle(element);
      return { background: css.backgroundColor, radius: css.borderTopLeftRadius };
    });
    expect(style).toEqual({ background: await token(page, '--s1'), radius: '16px' });
    await expect(panel.getByText('Shown in the Activity and History dashboards')).toBeVisible();
    await expect(
      panel.getByText("Blurs stills and hides descriptions of episodes you haven't finished", { exact: true }),
    ).toBeVisible();
    await expect(panel.getByRole('switch', { name: 'Hide episode spoilers' })).toHaveAttribute('aria-checked', 'true');
    await expect(panel.getByRole('button', { name: 'Save' })).toBeVisible();

    const text = await panel.innerText();
    for (const forbidden of READ_ONLY_TEXT) expect(text, forbidden).not.toContain(forbidden);
    const server = await info(page);
    expect(text).not.toContain(server.name);
    for (const address of server.lanAddresses) expect(text).not.toContain(address);
    for (const label of DESKTOP_LABELS) expect(text, label).not.toContain(label);
    await expect(panel.getByRole('heading', { name: 'Desktop' })).toHaveCount(0);
  });

  test('save the device name from the Settings tab', async ({ page }) => {
    await page.goto('/settings');
    await page.getByRole('textbox', { name: 'Device name' }).fill('Validator Tabs');
    const saved = page.waitForRequest(
      (request) => request.method() === 'POST' && request.url().endsWith('/api/devices'),
    );
    await page.getByRole('button', { name: 'Save' }).click();
    await saved;
    await expect(page.getByText('Device name saved.')).toBeVisible();
    await expect
      .poll(async () => {
        const body = (await (await page.request.get('/api/devices')).json()) as { devices: Array<{ name: string }> };
        return body.devices.map((device) => device.name);
      })
      .toContain('Validator Tabs');
    await page.reload();
    await expect(page.getByRole('textbox', { name: 'Device name' })).toHaveValue('Validator Tabs');
  });

  test('show a header and a two-column summary on About, as plain text and without secrets', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/settings#about');
    const server = await info(page);
    const about = aboutPanel(page);
    await expect(about.getByRole('heading', { level: 2, name: 'HomeStream' })).toBeVisible();
    await expect(about.getByText('Web app', { exact: true })).toBeVisible();
    await expect(about.getByText('Updates are not set up yet')).toHaveCount(0);
    await expect(about.getByRole('button')).toHaveCount(0);
    await expect(about.getByRole('heading', { level: 3 })).toHaveText(['Server', 'Network', 'Playback', 'This device']);

    const value = (name: string, label: string) =>
      group(page, name)
        .locator('dt', { has: page.getByText(label, { exact: true }) })
        .locator('xpath=following-sibling::dd[1]');
    await expect(value('Server', 'Server name')).toHaveText(server.name);
    await expect(value('Server', 'Version')).toHaveText(server.version);
    await expect(value('Server', 'Port')).toHaveText(String(server.port));
    await expect(value('Server', 'Server address')).toHaveText(await page.evaluate(() => location.origin));
    await expect(group(page, 'Network').getByText('Use one of these on a TV or phone')).toBeVisible();
    await expect(group(page, 'Network').getByRole('listitem')).toHaveText(server.lanAddresses);
    await expect(value('Playback', 'Stream source')).toHaveText('aiostreams (redacted)');
    await expect(group(page, 'Playback').getByText('What this browser asks the server to produce')).toBeVisible();
    await expect(value('Playback', 'Playback profile')).toHaveText('H.264 · SDR · up to 2160p · stereo');
    await expect(value('This device', 'Device type')).toHaveText('Web browser');

    const left = await rect(group(page, 'Server'));
    const right = await rect(group(page, 'Network'));
    expect(Math.abs(left.y - right.y)).toBeLessThanOrEqual(4);
    expect(right.x).toBeGreaterThan(left.x + left.width);

    const surfaces = [await token(page, '--s1'), await token(page, '--s2')];
    const cards = await about.evaluate(
      (root, colors) =>
        [...root.querySelectorAll('*')].filter((element) => {
          const css = getComputedStyle(element);
          return colors.includes(css.backgroundColor) || parseFloat(css.borderTopLeftRadius) >= 12;
        }).length,
      surfaces,
    );
    expect(cards).toBe(1);
    await expect(
      about.locator('input, select, textarea, [role="switch"], [role="checkbox"], [role="radio"]'),
    ).toHaveCount(0);

    const html = await page.evaluate(() => document.documentElement.outerHTML);
    for (const secret of ['e2e-not-a-real-token', `127.0.0.1:${ports.gateway}`, 'manifest.json']) {
      expect(html, secret).not.toContain(secret);
    }
  });
});

test.describe('Settings tabs inside the desktop app', () => {
  test.beforeEach(async ({ page }) => installDesktopBridge(page));

  test('show the Desktop card after This device, with the nine rows in order', async ({ page }) => {
    await page.goto('/settings');
    const panel = settingsPanel(page);
    await expect(panel.getByRole('heading')).toHaveText(['This device', 'Desktop']);
    const desktop = panel.getByRole('region', { name: 'Desktop' });
    const card = await desktop.innerText();
    const positions = DESKTOP_LABELS.map((label) => card.indexOf(label));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    await expect(desktop.getByText('Server: running (spawned, pid 1234)')).toBeVisible();
    await expect(desktop.getByRole('radio', { name: 'Keep running in tray' })).toBeChecked();

    const text = await panel.innerText();
    for (const forbidden of READ_ONLY_TEXT) expect(text, forbidden).not.toContain(forbidden);
    expect(text).not.toContain('Updates are not set up yet');
    expect(text).not.toContain(BRIDGE_VERSION);
  });

  test('show the version, the update status and the device type on About', async ({ page }) => {
    await page.goto('/settings#about');
    const about = aboutPanel(page);
    await expect(about.getByText(`Desktop app v${BRIDGE_VERSION} · Electron 45`)).toBeVisible();
    await expect(about.getByText('Updates are not set up yet')).toBeVisible();
    const check = about.getByRole('button', { name: 'Check for updates' });
    await expect(check).toBeDisabled();

    const requests: string[] = [];
    page.on('request', (request) => requests.push(request.url()));
    await check.click({ force: true });
    await page.waitForTimeout(300);
    expect(requests).toEqual([]);
    expect(await hash(page)).toBe('#about');

    await expect(group(page, 'This device').getByText('Desktop app', { exact: true })).toBeVisible();
    const text = await about.innerText();
    for (const label of DESKTOP_LABELS) expect(text, label).not.toContain(label);
  });
});

test.describe('Settings tabs in a plain browser', () => {
  test('have no Desktop card, update status or desktop rows', async ({ page }) => {
    await page.goto('/settings');
    await expect(settingsPanel(page).getByRole('heading', { name: 'Desktop' })).toHaveCount(0);
    for (const label of DESKTOP_LABELS) await expect(page.getByText(label, { exact: true })).toHaveCount(0);
    await tab(page, 'About').click();
    await expect(page.getByText('Updates are not set up yet')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Check for updates' })).toHaveCount(0);
  });
});
