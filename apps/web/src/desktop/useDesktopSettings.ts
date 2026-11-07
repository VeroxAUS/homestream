import { DEFAULT_DESKTOP_SETTINGS, type DesktopSettings, type DesktopSettingKey } from '@homestream/shared';
import { useCallback, useEffect, useState } from 'react';
import { logger } from '../logger';
import { desktopBridge } from './bridge';

export interface DesktopSettingsModel {
  settings: DesktopSettings;
  startWithWindows: boolean;
  /** The line getServerStatus() returns, refreshed while the page is open. */
  serverStatus: string;
  restartMessage: string;
  setSetting: (key: DesktopSettingKey, value: boolean | string) => void;
  setStartWithWindows: (enabled: boolean) => void;
  restartServer: () => void;
}

const STATUS_REFRESH_MS = 2000;

/** The values behind Settings > Desktop. Every change goes to the shell at once (there is no Save button). */
export function useDesktopSettings(): DesktopSettingsModel {
  const [settings, setSettings] = useState<DesktopSettings>(DEFAULT_DESKTOP_SETTINGS);
  const [startWithWindows, setStart] = useState(false);
  const [serverStatus, setServerStatus] = useState('');
  const [restartMessage, setRestartMessage] = useState('');

  useEffect(() => {
    const bridge = desktopBridge();
    if (!bridge) return;
    let active = true;
    const refreshStatus = () => void bridge.getServerStatus().then((text) => active && setServerStatus(text));
    void bridge.getDesktopSettings().then((value) => active && setSettings(value));
    void bridge.getStartWithWindows().then((value) => active && setStart(value));
    refreshStatus();
    const timer = window.setInterval(refreshStatus, STATUS_REFRESH_MS);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  const setSetting = useCallback((key: DesktopSettingKey, value: boolean | string) => {
    void desktopBridge()
      ?.setDesktopSetting(key, value)
      .then(setSettings)
      .catch(() => logger.warn('desktop', 'could not save a desktop setting'));
  }, []);

  const setStartWithWindows = useCallback((enabled: boolean) => {
    void desktopBridge()
      ?.setStartWithWindows(enabled)
      .then(setStart)
      .catch(() => logger.warn('desktop', 'could not change Start with Windows'));
  }, []);

  const restartServer = useCallback(() => {
    setRestartMessage('');
    void desktopBridge()
      ?.restartServer()
      .then((result) => setRestartMessage(result.ok ? '' : (result.message ?? '')));
  }, []);

  return { settings, startWithWindows, serverStatus, restartMessage, setSetting, setStartWithWindows, restartServer };
}
