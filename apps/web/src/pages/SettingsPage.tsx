import { useContentShown } from '../lib/useContentShown';
import { DesktopSettings } from '../desktop/DesktopSettings';
import { AboutPanel } from './settings/AboutPanel';
import { DeviceCard } from './settings/DeviceCard';
import { SettingsTabs, panelId, tabId } from './settings/SettingsTabs';
import { useSettingsTab } from './settings/useSettingsTab';
import styles from './SettingsPage.module.css';

export default function SettingsPage() {
  useContentShown();
  const [tab, selectTab] = useSettingsTab();
  return (
    <main className={styles.page}>
      <h1 className={styles.title}>Settings</h1>
      <SettingsTabs active={tab} onSelect={selectTab} />
      <div
        id={panelId('settings')}
        role="tabpanel"
        aria-labelledby={tabId('settings')}
        hidden={tab !== 'settings'}
        className={styles.sections}
      >
        <DeviceCard />
        <DesktopSettings />
      </div>
      <div id={panelId('about')} role="tabpanel" aria-labelledby={tabId('about')} hidden={tab !== 'about'}>
        <AboutPanel />
      </div>
    </main>
  );
}
