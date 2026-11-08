import { expect, test } from '@playwright/test';
import {
  aboutPanel,
  group,
  hash,
  mainNav,
  noSideScroll,
  rect,
  settingsPanel,
  tab,
  tabStyle,
  token,
} from './support/settingsPage';

test.describe('Settings tabs', () => {
  test('open on the Settings tab with two underline tabs styled like the dashboard tabs', async ({ page }) => {
    await page.goto('/');
    await mainNav(page).getByRole('link', { name: 'Settings', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();

    await expect(page.getByRole('tablist')).toHaveCount(1);
    await expect(page.getByRole('tab')).toHaveText(['Settings', 'About']);
    await expect(tab(page, 'Settings')).toHaveAttribute('aria-selected', 'true');
    await expect(tab(page, 'About')).toHaveAttribute('aria-selected', 'false');
    await expect(settingsPanel(page)).toBeVisible();
    await expect(aboutPanel(page)).toBeHidden();
    await expect(page.getByRole('tabpanel')).toHaveCount(1);
    expect(await tab(page, 'Settings').getAttribute('aria-controls')).toBe('settings-panel-settings');
    expect(['', '#settings']).toContain(await hash(page));

    const active = await tabStyle(tab(page, 'Settings'));
    const idle = await tabStyle(tab(page, 'About'));
    expect(active.fontSize).toBe('15px');
    expect(active.fontWeight).toBe('600');
    expect(active.border).toBe(`2px solid ${await token(page, '--accent')}`);
    expect(active.color).toBe(await token(page, '--text'));
    expect(idle.border).toBe('2px solid rgba(0, 0, 0, 0)');
    expect(idle.color).toBe(await token(page, '--mut'));

    await page.goto('/dashboard/health');
    const dashboard = page.getByRole('navigation', { name: 'Dashboard sections' });
    expect(await tabStyle(dashboard.getByRole('link', { name: 'Health' }))).toEqual(active);
    expect(await tabStyle(dashboard.getByRole('link', { name: 'Activity' }))).toEqual(idle);
  });

  test('use no filter or blur, and red only on the active tab, switches that are on and the Save button', async ({
    page,
  }) => {
    await page.goto('/settings');
    await expect(settingsPanel(page)).toBeVisible();
    const colors = [await token(page, '--accent'), await token(page, '--accent-hi')];
    for (const target of ['/settings', '/settings#about']) {
      await page.goto(target);
      await expect(page.getByRole('tab', { selected: true })).toBeVisible();
      const found = await page.evaluate(() => {
        const filters = new Set<string>();
        const elements = [...document.querySelectorAll('main, main *')].flatMap((element) => {
          const css = getComputedStyle(element);
          filters.add(`${css.filter}|${css.backdropFilter}`);
          if (element.getClientRects().length === 0) return [];
          const borders = ['top', 'right', 'bottom', 'left'].map((side) =>
            css.getPropertyValue(`border-${side}-width`) === '0px' ? '' : css.getPropertyValue(`border-${side}-color`),
          );
          return [
            {
              role: element.getAttribute('role'),
              label: `${element.tagName} "${element.textContent?.slice(0, 30)}"`,
              state: element.getAttribute('aria-selected') ?? element.getAttribute('aria-checked'),
              submit: element instanceof HTMLButtonElement && element.type === 'submit',
              colors: [css.color, css.backgroundColor, ...borders],
            },
          ];
        });
        return { elements, filters: [...filters] };
      });
      const offenders = found.elements
        .filter((element) => element.colors.some((color) => colors.includes(color)))
        .filter((element) => !((element.role === 'tab' || element.role === 'switch') && element.state === 'true'))
        .filter((element) => !element.submit)
        .map((element) => element.label);
      expect(offenders, target).toEqual([]);
      expect(found.filters, target).toEqual(['none|none']);
    }
  });

  test('open on About for #about without ever showing the Settings panel, and switch without a reload', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      (window as unknown as { __settingsSeen: boolean }).__settingsSeen = false;
      new MutationObserver(() => {
        const panel = document.getElementById('settings-panel-settings');
        if (panel && !panel.hidden) (window as unknown as { __settingsSeen: boolean }).__settingsSeen = true;
      }).observe(document, { childList: true, subtree: true, attributes: true });
    });
    await page.goto('/settings#about');
    await expect(tab(page, 'About')).toHaveAttribute('aria-selected', 'true');
    await expect(aboutPanel(page)).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __settingsSeen: boolean }).__settingsSeen)).toBe(false);

    const documents: string[] = [];
    page.on('request', (request) => {
      if (request.resourceType() === 'document') documents.push(request.url());
    });
    const before = await page.evaluate(() => ({ origin: performance.timeOrigin, length: history.length }));
    await tab(page, 'Settings').click();
    await expect(settingsPanel(page)).toBeVisible();
    expect(await hash(page)).toBe('#settings');
    expect(await page.evaluate(() => location.pathname)).toBe('/settings');
    await tab(page, 'About').click();
    await expect(aboutPanel(page)).toBeVisible();
    expect(await hash(page)).toBe('#about');
    const after = await page.evaluate(() => ({
      origin: performance.timeOrigin,
      length: history.length,
      navigations: performance.getEntriesByType('navigation').length,
    }));
    expect(after.origin).toBe(before.origin);
    expect(after.length).toBe(before.length);
    expect(after.navigations).toBe(1);
    expect(documents).toEqual([]);

    await page.reload();
    await expect(tab(page, 'About')).toHaveAttribute('aria-selected', 'true');
    for (const path of ['/settings', '/settings#settings', '/settings#nothing']) {
      await page.goto(path);
      await expect(tab(page, 'Settings')).toHaveAttribute('aria-selected', 'true');
      await expect(settingsPanel(page)).toBeVisible();
    }
  });

  test('add no history entry: Back after switching tabs leaves the settings page', async ({ page }) => {
    await page.goto('/');
    await expect(mainNav(page)).toBeVisible();
    await mainNav(page).getByRole('link', { name: 'Settings', exact: true }).click();
    await tab(page, 'About').click();
    await tab(page, 'Settings').click();
    await page.goBack();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('heading', { name: 'Trending Movies' })).toBeVisible();
  });

  test('stack the summary in one column below 700 px and never scroll sideways', async ({ page }) => {
    for (const width of [390, 690]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto('/settings#about');
      await expect(group(page, 'Network')).toBeVisible();
      const server = await rect(group(page, 'Server'));
      const network = await rect(group(page, 'Network'));
      expect(network.y, `${width}`).toBeGreaterThanOrEqual(server.y + server.height - 1);
      expect(Math.abs(network.x - server.x), `${width}`).toBeLessThanOrEqual(2);
      expect(await noSideScroll(page), `${width} about`).toBe(true);
      const size = await group(page, 'Server')
        .locator('dd')
        .first()
        .evaluate((element) => parseFloat(getComputedStyle(element).fontSize));
      expect(size).toBeGreaterThanOrEqual(14);

      await tab(page, 'Settings').click();
      await expect(settingsPanel(page)).toBeVisible();
      expect(await noSideScroll(page), `${width} settings`).toBe(true);
      const heading = await rect(page.getByRole('heading', { level: 1, name: 'Settings' }));
      for (const name of ['Settings', 'About']) {
        const box = await rect(tab(page, name));
        expect(box.height).toBeGreaterThanOrEqual(40);
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(width);
        expect(box.y).toBeGreaterThanOrEqual(heading.y + heading.height);
      }
    }
    for (const width of [760, 1280]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/settings#about');
      await expect(group(page, 'Network')).toBeVisible();
      const server = await rect(group(page, 'Server'));
      const network = await rect(group(page, 'Network'));
      expect(Math.abs(server.y - network.y), `${width}`).toBeLessThanOrEqual(4);
      expect(network.x, `${width}`).toBeGreaterThan(server.x + server.width);
    }
  });

  test('work with the keyboard', async ({ page }) => {
    await page.goto('/settings');
    await expect(settingsPanel(page)).toBeVisible();
    const origin = await page.evaluate(() => performance.timeOrigin);
    const selected = () => page.getByRole('tab', { selected: true });

    await mainNav(page)
      .locator('xpath=ancestor::header')
      .getByRole('link', { name: /healthy|warning|problem|Checking|unreachable/ })
      .focus();
    await page.keyboard.press('Tab');
    await expect(tab(page, 'Settings')).toBeFocused();
    await expect(tab(page, 'Settings')).toHaveAttribute('tabindex', '0');
    await expect(tab(page, 'About')).toHaveAttribute('tabindex', '-1');
    expect(await tab(page, 'Settings').evaluate((element) => getComputedStyle(element).outlineStyle)).not.toBe('none');

    await page.keyboard.press('ArrowRight');
    await expect(tab(page, 'About')).toBeFocused();
    await expect(selected()).toHaveText('About');
    await expect(aboutPanel(page)).toBeVisible();
    expect(await hash(page)).toBe('#about');
    await page.keyboard.press('ArrowRight');
    await expect(selected()).toHaveText('Settings');
    await page.keyboard.press('ArrowLeft');
    await expect(selected()).toHaveText('About');
    await page.keyboard.press('Home');
    await expect(selected()).toHaveText('Settings');
    await page.keyboard.press('End');
    await expect(selected()).toHaveText('About');
    expect(await page.evaluate(() => performance.timeOrigin)).toBe(origin);

    await page.keyboard.press('Home');
    await tab(page, 'About').focus();
    await expect(selected()).toHaveText('Settings');
    await page.keyboard.press('Enter');
    await expect(selected()).toHaveText('About');
    await tab(page, 'Settings').focus();
    await page.keyboard.press('Space');
    await expect(selected()).toHaveText('Settings');

    await page.keyboard.press('Tab');
    await expect(page.getByRole('textbox', { name: 'Device name' })).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(tab(page, 'Settings')).toBeFocused();
  });
});
