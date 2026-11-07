import type { HomestreamBridge } from '@homestream/shared';

/** The Electron preload bridge, or 
ull in a normal browser. */
export function desktopBridge(): HomestreamBridge | null {
  const bridge = window.homestream;
  return bridge?.isDesktop ? (bridge as HomestreamBridge) : null;
}

/** True inside the small always-on-top window that the main player hands its session to. */
export function inMiniPlayer(): boolean {
  return desktopBridge()?.isMiniPlayer === true;
}
