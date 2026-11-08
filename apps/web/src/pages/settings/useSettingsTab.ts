import { useCallback, useEffect, useState } from 'react';
import { useLocation } from 'react-router';

export const SETTINGS_TABS = ['settings', 'about'] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];

const tabFromHash = (hash: string): SettingsTab => (hash === '#about' ? 'about' : 'settings');

/**
 * The open tab, kept in the URL hash. The first render already reads the hash, so `/settings#about` never shows the
 * Settings tab first. A switch replaces the hash (no history entry, no reload).
 */
export function useSettingsTab(): [SettingsTab, (tab: SettingsTab) => void] {
  const { key } = useLocation();
  const [tab, setTab] = useState<SettingsTab>(() => tabFromHash(window.location.hash));

  // A router navigation to /settings (the nav link) replaces the URL without a hash and must reset the tab.
  useEffect(() => {
    const sync = () => setTab(tabFromHash(window.location.hash));
    sync();
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, [key]);

  const select = useCallback((next: SettingsTab) => {
    window.history.replaceState(window.history.state, '', `#${next}`);
    setTab(next);
  }, []);

  return [tab, select];
}
