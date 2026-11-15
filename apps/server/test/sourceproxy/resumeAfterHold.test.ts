import { describe, expect, it } from 'vitest';
import { BLOCK_SIZE } from '../../src/sourceproxy/blockCache.js';
import { EXTRACTOR_MAX_LEAD_BYTES } from '../../src/sourceproxy/leadBound.js';
import { MB, PacedReader, Reader, acquireSettled, installRigHooks, rig, sleep, upstreamRead } from './bandwidthRig.js';

installRigHooks();

const LO = 100 * MB;
const SPAN = 300 * MB;
/** Where the extractor starts past the encoder: beyond the 8 MB an encoder stream is waited for, so it downloads on its own. */
const START_AHEAD = 12 * MB;

/** Waits until a reader's byte count has not moved for `quietMs`. */
async function settled(reader: { received: number }, quietMs = 700): Promise<number> {
  let last = -1;
  let since = Date.now();
  for (;;) {
    if (reader.received !== last) {
      last = reader.received;
      since = Date.now();
    } else if (Date.now() - since >= quietMs) return last;
    await sleep(20);
  }
}

// The session's download rate comes only from upstream reads. A subtitle extractor that stopped far ahead of a stopped
// encoder holds the bytes the encoder reads next in the cache, so the encoder gets through them without any download and
// the window can close again before the rate rises.
describe('the upstream read resumes when the read-ahead window reopens', () => {
  it('the encoder reaches the end of the cached bytes, and so the network, within the extractor lead allowance', async () => {
    const proxy = rig({ maxDownloadMbps: 400, perSourceCapBytes: 256 * MB, globalCapBytes: 256 * MB });
    const handle = await acquireSettled(proxy, 'gw://resume-after-hold', 'session-1');
    handle.setLead(30);
    const encoder = new PacedReader(handle.url, LO, LO + SPAN - 1, 8 * MB);
    while (encoder.received === 0) await sleep(5);
    const extractor = new Reader(handle.extractorRunUrl(1), LO + START_AHEAD, LO + SPAN - 1);
    await sleep(2500);

    handle.setLead(180, 180);
    handle.setExtractorHold(1, true);
    expect(handle.readAhead).toBe('waiting');
    const encoderStopped = await settled(encoder);
    const extractorStopped = await settled(extractor);
    expect(extractorStopped).toBeGreaterThan(0);
    const aheadAtClose = START_AHEAD + extractorStopped - encoderStopped;

    const mark = upstreamRead.length;
    handle.setLead(100);
    expect(handle.readAhead).toBe('filling');
    await expect.poll(() => upstreamRead.length, { timeout: 20_000 }).toBeGreaterThan(mark);
    const cachedBytesServed = encoder.received - encoderStopped;

    expect(aheadAtClose).toBeLessThanOrEqual(EXTRACTOR_MAX_LEAD_BYTES + 4 * BLOCK_SIZE);
    expect(cachedBytesServed).toBeLessThanOrEqual(EXTRACTOR_MAX_LEAD_BYTES + 6 * BLOCK_SIZE);
  }, 60_000);
});
