import type { Locator, Page } from '@playwright/test';

export interface Info {
  name: string;
  version: string;
  port: number;
  lanAddresses: string[];
}

export const DESKTOP_LABELS = [
  'Start with Windows',
  'Start minimised to tray',
  'Close button',
  'Notify me when a title is ready to watch',
  'Notify me when playback or a download fails',
  'Hardware acceleration',
  'Server status',
  'Logs',
  'Quit HomeStream',
];

export const READ_ONLY_TEXT = [
  'Device type',
  'Web browser',
  'Desktop app',
  'Server name',
  'Version',
  'Server address',
  'Port',
  'LAN addresses',
  'Stream source',
  'aiostreams',
  'Playback profile',
  'H.264',
];

export const tab = (page: Page, name: string) => page.getByRole('tab', { name, exact: true });
export const settingsPanel = (page: Page) => page.locator('#settings-panel-settings');
export const aboutPanel = (page: Page) => page.locator('#settings-panel-about');
export const mainNav = (page: Page) => page.getByRole('navigation', { name: 'Main' });
export const hash = (page: Page) => page.evaluate(() => location.hash);
export const group = (page: Page, name: string) => aboutPanel(page).getByRole('group', { name, exact: true });
export const rect = async (locator: Locator) => (await locator.boundingBox())!;
export const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

export async function info(page: Page): Promise<Info> {
  return (await (await page.request.get('/api/info')).json()) as Info;
}

/** The computed colour of a CSS custom property such as `--accent`, to compare with computed styles. */
export async function token(page: Page, name: string): Promise<string> {
  return page.evaluate((property) => {
    const probe = document.createElement('i');
    probe.style.color = `var(${property})`;
    document.body.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  }, name);
}

export const tabStyle = (locator: Locator) =>
  locator.evaluate((element) => {
    const css = getComputedStyle(element);
    return {
      color: css.color,
      border: `${css.borderBottomWidth} ${css.borderBottomStyle} ${css.borderBottomColor}`,
      fontSize: css.fontSize,
      fontWeight: css.fontWeight,
    };
  });
