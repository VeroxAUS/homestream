import http from 'node:http';
import { describe, expect, it } from 'vitest';
import { BLOCK_SIZE } from '../../src/sourceproxy/blockCache.js';
import type { SourceHandle } from '../../src/sourceproxy/proxy.js';
import { MB, Reader, acquireSettled, cdn, installRigHooks, rig, sleep } from './bandwidthRig.js';
import { expectedBytes } from './stubCdn.js';

installRigHooks();

/** Reads a range at a fixed pace, like an encoder that consumes a few MB per second of media. */
class PacedReader {
  received = 0;
  ended = false;
  failed = false;
  private readonly chunks: Buffer[] = [];
  private req: http.ClientRequest;

  constructor(
    url: string,
    private readonly start: number,
    end: number,
    private readonly bytesPerSec: number,
    private readonly keep = false,
  ) {
    this.req = http.get(url, { headers: { Range: `bytes=${start}-${end}` }, agent: false }, (res) => {
      const began = Date.now();
      res.on('data', (chunk: Buffer) => {
        this.received += chunk.length;
        if (this.keep) this.chunks.push(chunk);
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

  matches(): boolean {
    const data = Buffer.concat(this.chunks);
    return data.equals(expectedBytes(this.start, this.start + data.length - 1));
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

  // Documents the capacity limit: an extractor that ran alone is not held (no encoder reader to stay close to), and LRU gives
  // no benefit to a sequential reader that trails a finished leader by more than the cache.
  it('an encoder that joins after an unbound extractor finished a range larger than the cache fetches it again, once', async () => {
    const cap = 32 * MB;
    const proxy = rig({ maxDownloadMbps: 400, perSourceCapBytes: cap, globalCapBytes: cap });
    const handle = await acquireSettled(proxy, 'gw://gap-exceeds', 'session-1');
    const mark = cdn.served.length;
    const extractor = new Reader(handle.extractorRunUrl(1), LO, HI - 1);
    await finished(extractor);
    expect(extractor.received).toBe(SPAN);
    const encoder = new Reader(handle.url, LO, HI - 1, true);
    await finished(encoder);
    expect(encoder.matches()).toBe(true);
    const { total, repeated } = cdnTraffic(LO, HI, mark);
    expect(repeated).toBeLessThanOrEqual(SPAN + 2 * BLOCK_SIZE);
    expect(total).toBeLessThanOrEqual(2 * SPAN + 2 * BLOCK_SIZE);
  }, 60_000);
});

// The per-source cache is 32 MB here and the span 40 MB: an extractor that is free to run ahead of the encoder would get
// further ahead than the cache holds, and the encoder would then download the range again.
describe('extractor lead over the encoder', () => {
  const CACHE = 32 * MB;
  // Longer than the cache plus the encoder's progress, so a refetch shows; the extractor starts beyond the 8 MB an encoder stream is waited for.
  const LONG = 80 * MB;
  const LONG_HI = LO + LONG;
  const AHEAD = 12 * MB;

  async function session(name: string): Promise<SourceHandle> {
    const proxy = rig({ maxDownloadMbps: 400, perSourceCapBytes: CACHE, globalCapBytes: CACHE });
    const handle = await acquireSettled(proxy, `gw://${name}`, 'session-1');
    // A healthy encoder lead: below 15 s the gate keeps every extractor read behind the encoder's.
    handle.setLead(30);
    return handle;
  }

  it('a fast extractor and a slower encoder on a source larger than the cache download each range once', async () => {
    const handle = await session('lead-once');
    const mark = cdn.served.length;
    const encoder = new PacedReader(handle.url, LO, LONG_HI - 1, 15 * MB, true);
    while (encoder.received === 0) await sleep(5);
    const extractor = new Reader(handle.extractorRunUrl(1), LO + AHEAD, LONG_HI - 1);
    await finished(extractor, encoder);
    expect(encoder.received).toBe(LONG);
    expect(encoder.matches()).toBe(true);
    expect(extractor.received).toBe(LONG - AHEAD);
    const { total, repeated } = cdnTraffic(LO, LONG_HI, mark);
    expect(repeated).toBeLessThanOrEqual(EDGE_MB * MB);
    expect(total).toBeLessThanOrEqual(LONG + EDGE_MB * MB);
  }, 60_000);

  it('holds the extractor at half the cache ahead of the encoder, and lets it go when the encoder moves on', async () => {
    const handle = await session('lead-hold');
    const encoder = new PacedReader(handle.url, LO, LONG_HI - 1, 10 * MB);
    while (encoder.received === 0) await sleep(5);
    const extractor = new Reader(handle.extractorRunUrl(1), LO + AHEAD, LONG_HI - 1);
    await sleep(600);
    const gap = AHEAD + extractor.received - encoder.received;
    expect(gap).toBeLessThanOrEqual(CACHE / 2 + 4 * BLOCK_SIZE);
    expect(gap).toBeGreaterThan(CACHE / 4);
    await finished(extractor, encoder);
    expect(extractor.received).toBe(LONG - AHEAD);
  }, 60_000);

  it('still reads a minute of media ahead while the encoder runs: [S, S+60] arrives long before the encoder is done', async () => {
    const handle = await session('lead-covers');
    const minute = 60 * MB;
    const encoder = new PacedReader(handle.url, LO, LO + 2 * minute - 1, 20 * MB);
    while (encoder.received === 0) await sleep(5);
    const preroll = 12 * MB;
    const extractor = new Reader(handle.extractorRunUrl(1), LO - preroll, LO + minute + 6 * MB - 1, true);
    await finished(extractor);
    expect(extractor.matches()).toBe(true);
    expect(extractor.received).toBe(preroll + minute + 6 * MB);
    expect(encoder.ended).toBe(false);
  }, 60_000);

  it('never holds an extractor that has no encoder reader, and frees a held one when the encoder goes away', async () => {
    const handle = await session('lead-alone');
    const alone = new Reader(handle.extractorRunUrl(1), LO, LONG_HI - 1);
    await finished(alone);
    expect(alone.received).toBe(LONG);

    const encoder = new PacedReader(handle.url, LONG_HI, LONG_HI + 100 * MB - 1, 5 * MB);
    while (encoder.received === 0) await sleep(5);
    const held = new Reader(handle.extractorRunUrl(2), LONG_HI + AHEAD, LONG_HI + 100 * MB - 1);
    await sleep(1200);
    expect(AHEAD + held.received - encoder.received).toBeLessThanOrEqual(CACHE / 2 + 4 * BLOCK_SIZE);
    encoder.stop();
    await finished(held);
    expect(held.received).toBe(100 * MB - AHEAD);
  }, 60_000);
});
