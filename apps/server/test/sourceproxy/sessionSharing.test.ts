import http from 'node:http';
import { describe, expect, it } from 'vitest';
import { BLOCK_SIZE } from '../../src/sourceproxy/blockCache.js';
import { MB, Reader, acquireSettled, cdn, installRigHooks, rig, sleep } from './bandwidthRig.js';

installRigHooks();

/** Reads a range at a fixed pace, like an encoder that consumes a few MB per second of media. */
class PacedReader {
  received = 0;
  ended = false;
  failed = false;
  private req: http.ClientRequest;

  constructor(
    url: string,
    start: number,
    end: number,
    private readonly bytesPerSec: number,
  ) {
    this.req = http.get(url, { headers: { Range: `bytes=${start}-${end}` }, agent: false }, (res) => {
      const began = Date.now();
      res.on('data', (chunk: Buffer) => {
        this.received += chunk.length;
        // Timers tick in ~15 ms steps on Windows, so pace against the running total rather than per chunk.
        const ahead = began + (this.received / this.bytesPerSec) * 1000 - Date.now();
        if (ahead < 15) return;
        res.pause();
        setTimeout(() => res.resume(), ahead);
      });
      res.on('end', () => {
        this.ended = true;
      });
      res.on('error', () => {
        this.failed = true;
      });
    });
    this.req.on('error', () => {
      this.failed = true;
    });
  }

  stop(): void {
    this.req.destroy();
  }
}

async function finished(...readers: Array<{ ended: boolean; failed: boolean }>): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (!readers.every((reader) => reader.ended || reader.failed)) {
    if (Date.now() > deadline) throw new Error('readers did not finish');
    await sleep(20);
  }
  expect(readers.some((reader) => reader.failed)).toBe(false);
}

/** Bytes the stub CDN wrote inside [lo, hi) since its served log had since entries, and how many of them it had already written before. */
function cdnTraffic(lo: number, hi: number, since: number): { total: number; repeated: number } {
  const intervals = cdn.served
    .slice(since)
    .map((part) => ({ start: Math.max(part.start, lo), end: Math.min(part.end, hi - 1) }))
    .filter((part) => part.end >= part.start)
    .sort((a, b) => a.start - b.start);
  let total = 0;
  let unique = 0;
  let reached = lo - 1;
  for (const part of intervals) {
    total += part.end - part.start + 1;
    const from = Math.max(part.start, reached + 1);
    if (part.end >= from) unique += part.end - from + 1;
    reached = Math.max(reached, part.end);
  }
  return { total, repeated: total - unique };
}

// A reader that ends a range early (its consumer moved on) can leave bytes already in flight; block edges add a little more.
const EDGE_MB = 3;

const LO = 100 * MB;
const SPAN = 40 * MB;
const HI = LO + SPAN;

describe('one session, one download per byte range', () => {
  it('extractor ahead of the encoder: the encoder takes the bytes the extractor fetched', async () => {
    const proxy = rig({ maxDownloadMbps: 400 });
    const handle = await acquireSettled(proxy, 'gw://extractor-ahead', 'session-1');
    const mark = cdn.served.length;
    const extractor = new Reader(handle.extractorUrl, LO, HI - 1);
    while (extractor.received < 15 * MB) await sleep(10);
    const encoder = new PacedReader(handle.url, LO, HI - 1, 20 * MB);
    await finished(extractor, encoder);
    expect(encoder.received).toBe(SPAN);
    const { total, repeated } = cdnTraffic(LO, HI, mark);
    expect(repeated).toBeLessThanOrEqual(EDGE_MB * MB);
    expect(total).toBeLessThanOrEqual(SPAN + EDGE_MB * MB);
  }, 60_000);

  it('extractor behind the encoder: the extractor takes the bytes the encoder fetched', async () => {
    const proxy = rig({ maxDownloadMbps: 400 });
    const handle = await acquireSettled(proxy, 'gw://extractor-behind', 'session-1');
    const mark = cdn.served.length;
    const encoder = new Reader(handle.url, LO, HI - 1);
    while (encoder.received < 15 * MB) await sleep(10);
    const extractor = new PacedReader(handle.extractorUrl, LO, HI - 1, 20 * MB);
    await finished(encoder, extractor);
    expect(extractor.received).toBe(SPAN);
    const { total, repeated } = cdnTraffic(LO, HI, mark);
    expect(repeated).toBeLessThanOrEqual(EDGE_MB * MB);
    expect(total).toBeLessThanOrEqual(SPAN + EDGE_MB * MB);
  }, 60_000);

  it('both start together and the extractor is the faster reader: it leads, the encoder follows', async () => {
    const proxy = rig({ maxDownloadMbps: 400 });
    const handle = await acquireSettled(proxy, 'gw://extractor-fast', 'session-1');
    const mark = cdn.served.length;
    const extractor = new PacedReader(handle.extractorUrl, LO, HI - 1, 40 * MB);
    const encoder = new PacedReader(handle.url, LO, HI - 1, 15 * MB);
    await finished(extractor, encoder);
    const { total, repeated } = cdnTraffic(LO, HI, mark);
    expect(repeated).toBeLessThanOrEqual(EDGE_MB * MB);
    expect(total).toBeLessThanOrEqual(SPAN + EDGE_MB * MB);
  }, 60_000);

  it('both start together and the encoder is the faster reader: the extractor follows it', async () => {
    const proxy = rig({ maxDownloadMbps: 400 });
    const handle = await acquireSettled(proxy, 'gw://encoder-fast', 'session-1');
    const mark = cdn.served.length;
    const encoder = new PacedReader(handle.url, LO, HI - 1, 40 * MB);
    const extractor = new PacedReader(handle.extractorUrl, LO, HI - 1, 15 * MB);
    await finished(encoder, extractor);
    const { total, repeated } = cdnTraffic(LO, HI, mark);
    expect(repeated).toBeLessThanOrEqual(EDGE_MB * MB);
    expect(total).toBeLessThanOrEqual(SPAN + EDGE_MB * MB);
  }, 60_000);

  it('extractor starts a preroll behind the encoder position and catches up: only the preroll is its own download', async () => {
    const proxy = rig({ maxDownloadMbps: 400 });
    const handle = await acquireSettled(proxy, 'gw://preroll', 'session-1');
    const mark = cdn.served.length;
    const preroll = 12 * MB;
    const encoder = new PacedReader(handle.url, LO, HI - 1, 20 * MB);
    const extractor = new PacedReader(handle.extractorUrl, LO - preroll, HI - 1, 30 * MB);
    await finished(encoder, extractor);
    const { total, repeated } = cdnTraffic(LO - preroll, HI, mark);
    expect(repeated).toBeLessThanOrEqual(EDGE_MB * MB);
    expect(total).toBeLessThanOrEqual(SPAN + preroll + EDGE_MB * MB);
  }, 60_000);

  it('a stream that runs into blocks another stream stored ahead of it stops downloading them', async () => {
    const proxy = rig({ maxDownloadMbps: 400 });
    const handle = await acquireSettled(proxy, 'gw://runs-into', 'session-1');
    const mark = cdn.served.length;
    const encoder = new PacedReader(handle.url, LO, HI - 1, 12 * MB);
    await sleep(300);
    const extractor = new Reader(handle.extractorUrl, LO + 20 * MB, HI - 1);
    await finished(extractor, encoder);
    expect(encoder.received).toBe(SPAN);
    const { total, repeated } = cdnTraffic(LO, HI, mark);
    expect(repeated).toBeLessThanOrEqual(EDGE_MB * MB);
    expect(total).toBeLessThanOrEqual(SPAN + EDGE_MB * MB);
  }, 60_000);

  it('a reader far behind the other one finds everything in the cache while the gap fits it', async () => {
    const proxy = rig({ maxDownloadMbps: 400 });
    const handle = await acquireSettled(proxy, 'gw://gap-fits', 'session-1');
    const mark = cdn.served.length;
    const encoder = new Reader(handle.url, LO, HI - 1);
    await finished(encoder);
    const extractor = new Reader(handle.extractorUrl, LO, HI - 1, true);
    await finished(extractor);
    expect(extractor.matches()).toBe(true);
    expect(cdnTraffic(LO, HI, mark)).toEqual({ total: SPAN, repeated: 0 });
  }, 60_000);

  // Documents the capacity limit: LRU gives no benefit to a sequential reader that trails a leader by more than the cache.
  it('when the gap is larger than the per-source cache the trailing reader fetches the range again, once', async () => {
    const cap = 32 * MB;
    const proxy = rig({ maxDownloadMbps: 400, perSourceCapBytes: cap, globalCapBytes: cap });
    const handle = await acquireSettled(proxy, 'gw://gap-exceeds', 'session-1');
    const mark = cdn.served.length;
    const extractor = new Reader(handle.extractorUrl, LO, HI - 1);
    await finished(extractor);
    const encoder = new Reader(handle.url, LO, HI - 1, true);
    await finished(encoder);
    expect(encoder.matches()).toBe(true);
    const { total, repeated } = cdnTraffic(LO, HI, mark);
    expect(repeated).toBeLessThanOrEqual(SPAN + 2 * BLOCK_SIZE);
    expect(total).toBeLessThanOrEqual(2 * SPAN + 2 * BLOCK_SIZE);
  }, 60_000);
});
