import { describe, expect, it } from 'vitest';
import { MB, Reader, cdn, installRigHooks, rig, sleep } from './bandwidthRig.js';

installRigHooks();

describe('download cap', () => {
  // The stub counts bytes when it writes them. Linux loopback sockets buffer several MB per connection, so the stub runs
  // ahead of the proxy's reads and overstates the first windows. Windows loopback buffers are small enough to measure.
  it.skipIf(process.platform !== 'win32')(
    'keeps every 5 s window of upstream bytes within the cap, from the first byte on (60 Mbps, three greedy readers)',
    async () => {
      const proxy = rig({ maxDownloadMbps: 60 });
      const baseline = cdn.sentBytes;
      const samples: Array<{ at: number; sent: number; server: number }> = [];
      const t0 = performance.now();
      const sample = (): void => {
        samples.push({ at: performance.now() - t0, sent: cdn.sentBytes - baseline, server: proxy.network().rateMbps });
      };

      // The warm-up of the head and tail is part of the measurement.
      const handle = await proxy.acquire('gw://cap', 'session-1');
      const encoder = new Reader(handle.url, 40 * MB, '');
      const second = new Reader(handle.url, 200 * MB, '');
      const extractor = new Reader(handle.extractorUrl, 300 * MB, '');
      const ticker = setInterval(sample, 100);
      await sleep(11_000);
      clearInterval(ticker);
      sample();
      expect(encoder.failed || second.failed || extractor.failed).toBe(false);

      let worstWindow = 0;
      for (const end of samples) {
        const begin = samples.findLast((item) => item.at <= end.at - 5000);
        if (!begin) continue;
        worstWindow = Math.max(worstWindow, ((end.sent - begin.sent) * 8) / 1_000_000 / ((end.at - begin.at) / 1000));
      }
      const total = samples.at(-1) as (typeof samples)[number];
      const average = (total.sent * 8) / 1_000_000 / (total.at / 1000);
      const worstServer = Math.max(...samples.map((item) => item.server));

      // The independent counter of the stub CDN: at most 66 Mbps over any 5 s window, and the cap is actually used.
      expect(worstWindow).toBeLessThanOrEqual(66);
      expect(average).toBeGreaterThan(54);
      // The proxy's own 5 s figure stays within 63.
      expect(worstServer).toBeLessThanOrEqual(63);
      expect(proxy.network()).toMatchObject({ capMbps: 60, readAheadSec: 180, resumeSec: 120 });
      expect(proxy.network().limitedForSec).toBeGreaterThan(5);
    },
    40_000,
  );

  it('reports the rate as idle again once the readers stop', async () => {
    const proxy = rig({ maxDownloadMbps: 60 });
    const handle = await proxy.acquire('gw://idle', 'session-1');
    const reader = new Reader(handle.url, 40 * MB, 60 * MB - 1);
    while (!reader.ended) await sleep(50);
    expect(handle.rateMbps()).toBeGreaterThan(5);
    await sleep(5500);
    expect(proxy.network().rateMbps).toBeLessThan(1);
    expect(proxy.network().limitedForSec).toBe(0);
  }, 40_000);
});
