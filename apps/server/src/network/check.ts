import type { NetworkCheck, NetworkDetails } from '@homestream/shared';

/** The check turns to `warn` once the cap has been binding for longer than this. */
export const WARN_AFTER_LIMITED_SEC = 30;

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function formatMbps(value: number): string {
  return value >= 100 ? String(Math.round(value)) : value.toFixed(1);
}

/** The health `network` check for a live snapshot. Contains no URLs, hosts or source keys, only session ids and numbers. */
export function buildNetworkCheck(
  snapshot: NetworkDetails,
  options: { nowMs: number; latencyMs?: number; configPath?: string },
): NetworkCheck {
  const details: NetworkDetails = {
    ...snapshot,
    rateMbps: round(snapshot.rateMbps),
    limitedForSec: round(snapshot.limitedForSec, 1),
    sessions: snapshot.sessions.map((session) => ({ ...session, rateMbps: round(session.rateMbps), leadSec: round(session.leadSec, 1) })),
  };
  const base = {
    id: 'network' as const,
    name: 'Download rate',
    latencyMs: options.latencyMs ?? 0,
    checkedAt: new Date(options.nowMs).toISOString(),
    details,
  };
  if (snapshot.limitedForSec > WARN_AFTER_LIMITED_SEC) {
    return {
      ...base,
      status: 'warn',
      message: `Downloads have been held at the ${snapshot.capMbps} Mbps limit for ${Math.round(snapshot.limitedForSec)} s.`,
      hint: `The limit keeps the rest of the household's internet usable, so playback may start slower or seeks may take longer. To allow faster downloads, raise MAX_DOWNLOAD_MBPS${options.configPath ? ` in ${options.configPath}` : ''} and restart the server.`,
    };
  }
  return { ...base, status: 'ok', message: `Downloading ${formatMbps(snapshot.rateMbps)} of ${snapshot.capMbps} Mbps.` };
}
