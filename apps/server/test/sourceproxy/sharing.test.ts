import { describe, expect, it } from 'vitest';
import { MB, Reader, acquireSettled, cdn, installRigHooks, rig, sleep } from './bandwidthRig.js';

installRigHooks();

describe('sharing between encoder and extractor', () => {
  it('fetches each range from upstream once when the extractor reads what the encoder has just read, and the other way round', async () => {
    const proxy = rig({ maxDownloadMbps: 400 });
    const handle = await acquireSettled(proxy, 'gw://share', 'session-1');
    const forward = [120 * MB, 130 * MB - 1] as const;

    const before = cdn.sentBytes;
    const viaEncoder = new Reader(handle.url, forward[0], forward[1], true);
    while (!viaEncoder.ended) await sleep(20);
    const encoderFetched = cdn.sentBytes - before;
    expect(encoderFetched).toBeGreaterThanOrEqual(10 * MB);

    const viaExtractor = new Reader(handle.extractorUrl, forward[0], forward[1], true);
    while (!viaExtractor.ended) await sleep(20);
    expect(cdn.sentBytes - before).toBe(encoderFetched);
    expect(viaExtractor.matches()).toBe(true);

    const reverse = [140 * MB, 150 * MB - 1] as const;
    const mark = cdn.sentBytes;
    const first = new Reader(handle.extractorUrl, reverse[0], reverse[1], true);
    while (!first.ended) await sleep(20);
    const extractorFetched = cdn.sentBytes - mark;
    const later = new Reader(handle.url, reverse[0], reverse[1], true);
    while (!later.ended) await sleep(20);
    expect(cdn.sentBytes - mark).toBe(extractorFetched);
    expect(later.matches()).toBe(true);
  }, 30_000);

  it('lets a trailing reader take the bytes a leading one is bringing instead of fetching them again', async () => {
    const proxy = rig({ maxDownloadMbps: 60 });
    const handle = await acquireSettled(proxy, 'gw://trail', 'session-1');
    const range = [160 * MB, 180 * MB - 1] as const;
    const before = cdn.sentBytes;
    const leader = new Reader(handle.url, range[0], range[1]);
    await sleep(700);
    const trailer = new Reader(handle.extractorUrl, range[0], range[1], true);
    while (!leader.ended || !trailer.ended) await sleep(50);
    const fetched = cdn.sentBytes - before;
    expect(trailer.received).toBe(20 * MB);
    expect(trailer.matches()).toBe(true);
    expect(fetched).toBeLessThanOrEqual(20 * MB * 1.1);
  }, 60_000);
});
