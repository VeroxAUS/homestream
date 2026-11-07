import type { HomestreamBridge } from '@homestream/shared';
import type { RawTelemetryConfig } from './telemetry/config';

declare global {
  /** Replaced by Vite at build time (vite.config.ts). The telemetry keys never come from a runtime request. */
  const HS_TELEMETRY: RawTelemetryConfig;

  interface Window {
    /** Set by the Electron preload (see desktopBridge()); absent in a browser. */
    homestream?: Partial<Omit<HomestreamBridge, 'isDesktop'>> & { isDesktop?: boolean };
  }
}
