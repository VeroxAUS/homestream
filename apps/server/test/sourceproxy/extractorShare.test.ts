import http from 'node:http';
import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';
import { createSilentLogger } from '../../src/logger.js';
import type { ProbeResult } from '../../src/playback/probe.js';
import { SourceProxy } from '../../src/sourceproxy/proxy.js';
import { startStubCdn, type StubCdn } from './stubCdn.js';

const MB = 1024 * 1024;
const STARVED_BYTES_PER_SEC = 2 * MB;

let cdn: StubCdn;
const proxies: SourceProxy[] = [];

beforeAll(async () => {
  cdn = await startStubCdn({ size: 64 * MB });
});

afterAll(async () => {
  await cdn.close();
});

afterEach(async () => {
  await Promise.all(proxies.splice(0).map((proxy) => proxy.close()));
});

async function read(url: string, range: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    http
      .get(url, { headers: { Range: range }, agent: false }, (res) => {
        res.on('data', () => undefined);
        res.on('end', () => resolve());
        res.on('error', reject);
      })
      .on('error', reject);
  });
}

async function timedExtractorRead(maxDownloadMbps: number, length: number): Promise<number> {
  const proxy = new SourceProxy({
    resolveUrl: async () => `${cdn.url}?share`,
    probe: async () => ({ durationSec: 10 }) as ProbeResult,
    port: 0,
    logger: createSilentLogger(),
    maxDownloadMbps,
  });
  proxies.push(proxy);
  const handle = await proxy.acquire('gw://share', 'session-1');
  // Head and tail fill front to back, so their last bytes are only served once each region is completely in memory.
  await read(handle.url, `bytes=${16 * MB - 1}-${16 * MB - 1}`);
  await read(handle.url, `bytes=${64 * MB - 1}-`);
  handle.setExtractorLimit(STARVED_BYTES_PER_SEC);
  const started = performance.now();
  await read(handle.extractorUrl, `bytes=${45 * MB}-${45 * MB + length - 1}`);
  return performance.now() - started;
}

it('never paces extractor reads below the guaranteed share of the cap', async () => {
  const length = 4 * MB;
  // Cap 40: the share is 8 Mbps, well under the 2 MiB/s limit, so the limit paces. Cap 150: the share is 30 Mbps (3.6 MiB/s) and lifts it.
  const limited = await timedExtractorRead(40, length);
  const lifted = await timedExtractorRead(150, length);
  expect(limited).toBeGreaterThanOrEqual((length / STARVED_BYTES_PER_SEC) * 1000 * 0.8);
  expect(lifted).toBeLessThan(limited * 0.85);
}, 60_000);
