import type { Config } from '../../config.js';
import type { GatewayStats } from '../../gateway/client.js';
import { GATEWAY_LABEL } from '../../redact.js';
import { failure, type CheckOutcome } from './types.js';

export const GATEWAY_CHECK_TIMEOUT_MS = 10_000;

export type HealthFetch = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<Response>;

const UNREACHABLE_HINT = 'Gateway unreachable - check your internet connection or the AIOStreams instance, then run the check again.';

export interface GatewayCheckDeps {
  config: Pick<Config, 'gatewayManifestUrl' | 'configFile'>;
  stats: Readonly<GatewayStats>;
  fetch: HealthFetch;
  timeoutMs?: number;
  now?: () => number;
}

/**
 * Reads the addon manifest only. The stream endpoint is never called here (rate limit), and nothing from the URL is put into the
 * result: failures describe the problem in words, not with the exception text, which would carry the host.
 */
export async function checkGateway(deps: GatewayCheckDeps): Promise<CheckOutcome> {
  const { config, stats } = deps;
  const url = config.gatewayManifestUrl;
  if (!url) {
    return failure(
      'The stream gateway is not configured (GATEWAY_MANIFEST_URL is missing).',
      `Add GATEWAY_MANIFEST_URL=<your AIOStreams manifest URL> to ${config.configFile.path} and restart HomeStream.`,
      { url: null },
    );
  }

  const lookups = {
    lookups: stats.requests,
    lookupErrors: stats.errors,
    lastLookupLatencyMs: stats.lastLatencyMs,
    lastLookupAt: stats.lastLookupAt === null ? null : new Date(stats.lastLookupAt).toISOString(),
    lastLookupError: stats.lastError,
  };
  const base = { url: GATEWAY_LABEL, ...lookups };

  let response: Response;
  try {
    response = await deps.fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(deps.timeoutMs ?? GATEWAY_CHECK_TIMEOUT_MS) });
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
    return failure(
      timedOut ? 'The gateway did not answer within 10 seconds.' : 'The gateway could not be reached.',
      timedOut ? 'The AIOStreams instance is slow or down. Check that it is running, then run the check again.' : UNREACHABLE_HINT,
      base,
    );
  }

  if (!response.ok) {
    const status = response.status;
    const refused = status === 401 || status === 403 || status === 404;
    return failure(
      `The gateway answered the manifest request with HTTP ${status}.`,
      refused
        ? `The gateway refused the manifest. Check GATEWAY_MANIFEST_URL in ${config.configFile.path}: copy the manifest URL again from your AIOStreams configuration.`
        : 'The AIOStreams instance has a problem on its side. Try again in a few minutes.',
      { ...base, httpStatus: status },
    );
  }

  let manifest: { name?: unknown; version?: unknown };
  try {
    manifest = (await response.json()) as typeof manifest;
  } catch {
    manifest = {};
  }
  if (typeof manifest.name !== 'string' || !manifest.name) {
    return failure(
      'The gateway answered, but not with an addon manifest.',
      `Check GATEWAY_MANIFEST_URL in ${config.configFile.path}: it must be the manifest.json URL of your AIOStreams configuration.`,
      base,
    );
  }

  const addon = { name: manifest.name, version: typeof manifest.version === 'string' ? manifest.version : null };
  const details = { ...base, addon, addonName: addon.name, addonVersion: addon.version };
  if (stats.lastError) {
    return {
      status: 'warn',
      message: `The gateway is reachable (${addon.name}${addon.version ? ` ${addon.version}` : ''}), but the last stream lookup failed.`,
      hint: 'Stream lookups sometimes fail when the gateway is busy. Try playing again in a minute; if it keeps failing, check the AIOStreams instance.',
      details,
    };
  }
  return { status: 'ok', message: `${addon.name}${addon.version ? ` ${addon.version}` : ''} is reachable.`, details };
}
