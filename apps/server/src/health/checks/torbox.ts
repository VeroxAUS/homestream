import type { Config } from '../../config.js';
import type { HealthFetch } from './gateway.js';
import { failure, type CheckOutcome } from './types.js';

const TORBOX_USER_URL = 'https://api.torbox.app/v1/api/user/me';
const TORBOX_CHECK_TIMEOUT_MS = 10_000;
const TORBOX_WARN_DAYS = 7;
const DAY_MS = 24 * 3600 * 1000;
const PLAN_NAMES: Record<number, string> = { 0: 'Free', 1: 'Essential', 2: 'Pro', 3: 'Standard' };

export interface TorboxCheckDeps {
  config: Pick<Config, 'torboxApiKey' | 'configFile'>;
  fetch: HealthFetch;
  nowMs: number;
  timeoutMs?: number;
}

const KEY_HINT = (path: string): string =>
  `Re-check the TorBox API key at torbox.app (Settings > API) and update TORBOX_API_KEY in ${path}, then restart HomeStream.`;

/** Only plan, subscription and expiry are read from the account; email, ids and referral data are never copied. */
export async function checkTorbox(deps: TorboxCheckDeps): Promise<CheckOutcome> {
  const { config } = deps;
  const key = config.torboxApiKey;
  if (!key) {
    return {
      status: 'warn',
      message: 'No TorBox API key is set, so the account cannot be checked.',
      hint: `Add TORBOX_API_KEY=<your key from torbox.app > Settings > API> to ${config.configFile.path} and restart HomeStream. Playing cached titles still works.`,
      details: { configured: false },
    };
  }

  let response: Response;
  try {
    response = await deps.fetch(TORBOX_USER_URL, {
      headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(deps.timeoutMs ?? TORBOX_CHECK_TIMEOUT_MS),
    });
  } catch {
    return failure(
      'TorBox could not be reached.',
      'TorBox unreachable - check your internet connection. If it works elsewhere, TorBox may be down; try again in a few minutes.',
      { configured: true },
    );
  }

  if (response.status === 401 || response.status === 403) {
    return failure('TorBox rejected the API key.', KEY_HINT(config.configFile.path), {
      configured: true,
      httpStatus: response.status,
    });
  }
  if (!response.ok) {
    return failure(
      `TorBox answered with HTTP ${response.status}.`,
      'TorBox has a problem on its side or is rate limiting. Try again in a few minutes.',
      { configured: true, httpStatus: response.status },
    );
  }

  type Account = { plan?: unknown; is_subscribed?: unknown; premium_expires_at?: unknown };
  let data: Account | null = null;
  try {
    const body = (await response.json()) as { success?: unknown; data?: unknown };
    if (body.success !== false && body.data && typeof body.data === 'object') data = body.data as Account;
  } catch {
    data = null;
  }
  if (!data) {
    return failure('TorBox answered, but the reply could not be understood.', KEY_HINT(deps.config.configFile.path), {
      configured: true,
    });
  }

  const planId = typeof data.plan === 'number' ? data.plan : null;
  const plan = planId === null ? 'unknown' : (PLAN_NAMES[planId] ?? `plan ${planId}`);
  const isSubscribed = data.is_subscribed === true;
  const expiresAt =
    typeof data.premium_expires_at === 'string' && data.premium_expires_at ? data.premium_expires_at : null;
  const expiresMs = expiresAt ? Date.parse(expiresAt) : NaN;
  const daysLeft = Number.isFinite(expiresMs) ? Math.floor((expiresMs - deps.nowMs) / DAY_MS) : null;
  const details = {
    configured: true,
    plan,
    planId,
    is_subscribed: isSubscribed,
    premium_expires_at: Number.isFinite(expiresMs) ? new Date(expiresMs).toISOString() : null,
    daysLeft,
  };

  const renew = 'TorBox subscription expired - renew it at torbox.app, then run the check again.';
  if (!isSubscribed || (daysLeft !== null && expiresMs <= deps.nowMs)) {
    return { status: 'error', message: `The TorBox subscription is not active (${plan}).`, hint: renew, details };
  }
  if (daysLeft !== null && daysLeft < TORBOX_WARN_DAYS) {
    return {
      status: 'warn',
      message: `The TorBox ${plan} plan expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}.`,
      hint: 'Renew the subscription at torbox.app before it ends, otherwise playback stops.',
      details,
    };
  }
  return {
    status: 'ok',
    message: `TorBox ${plan} plan is active${daysLeft === null ? '' : `, ${daysLeft} days left`}.`,
    details,
  };
}
