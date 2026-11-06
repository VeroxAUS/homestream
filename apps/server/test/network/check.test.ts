import { NetworkCheckSchema, type NetworkDetails } from '@homestream/shared';
import { describe, expect, it } from 'vitest';
import { WARN_AFTER_LIMITED_SEC, buildNetworkCheck } from '../../src/network/check.js';

const NOW = Date.UTC(2026, 10, 6, 12, 0, 0);

function snapshot(overrides: Partial<NetworkDetails> = {}): NetworkDetails {
  return { rateMbps: 0, capMbps: 60, readAheadSec: 180, resumeSec: 120, limitedForSec: 0, sessions: [], ...overrides };
}

describe('buildNetworkCheck', () => {
  it('is ok and idle with no session, in the standard check shape', () => {
    const check = buildNetworkCheck(snapshot(), { nowMs: NOW, latencyMs: 3 });
    expect(check).toMatchObject({ id: 'network', status: 'ok', latencyMs: 3, checkedAt: '2026-11-06T12:00:00.000Z' });
    expect(check.message).toBe('Downloading 0.0 of 60 Mbps.');
    expect(check.hint).toBeUndefined();
    expect(check.details).toMatchObject({ rateMbps: 0, capMbps: 60, readAheadSec: 180, resumeSec: 120, sessions: [] });
    expect(NetworkCheckSchema.parse(check)).toEqual(check);
  });

  it('puts the rate and the cap into the line the dashboard shows', () => {
    expect(buildNetworkCheck(snapshot({ rateMbps: 41.234, capMbps: 150 }), { nowMs: NOW }).message).toBe(
      'Downloading 41.2 of 150 Mbps.',
    );
    expect(buildNetworkCheck(snapshot({ rateMbps: 148.6, capMbps: 150 }), { nowMs: NOW }).message).toBe(
      'Downloading 149 of 150 Mbps.',
    );
  });

  it('lists sessions with their own rate, state and lead, rounded', () => {
    const check = buildNetworkCheck(
      snapshot({
        rateMbps: 30,
        sessions: [
          { sessionId: 'a', rateMbps: 29.99999, readAhead: 'filling', leadSec: 12.345 },
          { sessionId: 'b', rateMbps: 0.001, readAhead: 'waiting', leadSec: 176 },
        ],
      }),
      { nowMs: NOW },
    );
    expect(check.details.sessions).toEqual([
      { sessionId: 'a', rateMbps: 30, readAhead: 'filling', leadSec: 12.3 },
      { sessionId: 'b', rateMbps: 0, readAhead: 'waiting', leadSec: 176 },
    ]);
  });

  it('stays ok up to 30 s at the cap and warns after that, with a hint about MAX_DOWNLOAD_MBPS', () => {
    expect(
      buildNetworkCheck(snapshot({ rateMbps: 59, limitedForSec: WARN_AFTER_LIMITED_SEC }), { nowMs: NOW }).status,
    ).toBe('ok');
    const warn = buildNetworkCheck(snapshot({ rateMbps: 59, limitedForSec: 31 }), {
      nowMs: NOW,
      configPath: 'C:\\x\\config.env',
    });
    expect(warn.status).toBe('warn');
    expect(warn.message).toContain('60 Mbps');
    expect(warn.hint).toContain('MAX_DOWNLOAD_MBPS');
    expect(warn.hint).toContain('C:\\x\\config.env');
    expect(NetworkCheckSchema.parse(warn)).toEqual(warn);
  });

  it('never reports an error', () => {
    expect(buildNetworkCheck(snapshot({ limitedForSec: 100_000 }), { nowMs: NOW }).status).toBe('warn');
  });
});
