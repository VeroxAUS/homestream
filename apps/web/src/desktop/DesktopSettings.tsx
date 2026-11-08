import { CLOSE_BEHAVIOURS } from '@homestream/shared';
import { Toggle } from '../components/Toggle';
import { Row } from '../pages/SettingsRow';
import settingsStyles from '../pages/SettingsPage.module.css';
import { desktopBridge } from './bridge';
import styles from './DesktopSettings.module.css';
import { useDesktopSettings } from './useDesktopSettings';

const CLOSE_LABELS: Record<(typeof CLOSE_BEHAVIOURS)[number], string> = { tray: 'Keep running in tray', quit: 'Quit' };

function Segmented({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div className={styles.segmented} role="radiogroup" aria-label="Close button">
      {CLOSE_BEHAVIOURS.map((option) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={value === option}
          className={styles.segment}
          onClick={() => onChange(option)}
        >
          {CLOSE_LABELS[option]}
        </button>
      ))}
    </div>
  );
}

/** Settings > Desktop: only inside the Electron app. The rows and their words are fixed by the design. */
export function DesktopSettings() {
  const model = useDesktopSettings();
  const { settings } = model;
  const bridge = desktopBridge();
  if (!bridge) return null;
  return (
    <section aria-labelledby="settings-desktop">
      <h2 id="settings-desktop" className={settingsStyles.section}>
        Desktop
      </h2>
      <div className={settingsStyles.card}>
        <Row
          label="Start with Windows"
          help="Starts when you sign in, so the TV can play without opening the app first"
        >
          <Toggle label="Start with Windows" checked={model.startWithWindows} onChange={model.setStartWithWindows} />
        </Row>
        <Row
          label="Start minimised to tray"
          help="When started with Windows, stay in the tray instead of opening the window"
        >
          <Toggle
            label="Start minimised to tray"
            checked={settings.startMinimized}
            onChange={(value) => model.setSetting('startMinimized', value)}
          />
        </Row>
        <Row label="Close button" help="Closing the window keeps the server running for your other devices">
          <Segmented value={settings.closeBehaviour} onChange={(value) => model.setSetting('closeBehaviour', value)} />
        </Row>
        <Row
          label="Notify me when a title is ready to watch"
          help="A Windows notification when a TorBox download finishes"
        >
          <Toggle
            label="Notify me when a title is ready to watch"
            checked={settings.notifyReady}
            onChange={(value) => model.setSetting('notifyReady', value)}
          />
        </Row>
        <Row
          label="Notify me when playback or a download fails"
          help="Only while the HomeStream window is not in front. Windows Settings > System > Notifications can also turn HomeStream off"
        >
          <Toggle
            label="Notify me when playback or a download fails"
            checked={settings.notifyFailures}
            onChange={(value) => model.setSetting('notifyFailures', value)}
          />
        </Row>
        <Row
          label="Hardware acceleration"
          help="Uses the GPU to draw the app. Turn off only if the window flickers or video shows black or green blocks. Takes effect after a restart"
        >
          <Toggle
            label="Hardware acceleration"
            checked={settings.hardwareAcceleration}
            onChange={(value) => model.setSetting('hardwareAcceleration', value)}
          />
        </Row>
        <Row label="Server status" help={model.restartMessage || model.serverStatus}>
          <button type="button" className={styles.small} onClick={model.restartServer}>
            Restart server
          </button>
        </Row>
        <Row label="Logs" help="Server and app logs. Keys and stream links are never written to them">
          <button type="button" className={styles.small} onClick={() => void bridge.openLogs()}>
            Open logs folder
          </button>
        </Row>
        <Row label="Quit HomeStream" help="Stops the server this app started">
          <button type="button" className={`${styles.small} ${styles.outline}`} onClick={() => void bridge.quit()}>
            Quit
          </button>
        </Row>
      </div>
    </section>
  );
}

/** The first row of About inside the app: the desktop version, and an update check that is not set up yet. */
export function AboutDesktopRow() {
  const bridge = desktopBridge();
  if (!bridge) return null;
  return (
    <Row label="HomeStream" help={`Desktop app v${bridge.version} \u00b7 Electron 45`}>
      <span className={styles.note}>Updates are not set up yet</span>
      <button type="button" className={`${styles.small} ${styles.outline}`} disabled>
        Check for updates
      </button>
    </Row>
  );
}
