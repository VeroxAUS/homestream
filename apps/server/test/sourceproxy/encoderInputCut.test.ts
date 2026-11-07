import { describe, expect, it } from 'vitest';
import { MB, Reader, acquireSettled, installRigHooks, rig, sleep } from './bandwidthRig.js';

installRigHooks();

async function untilTrue(condition: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('condition not reached in time');
    await sleep(20);
  }
}

describe('cutting the encoder input of one owner', () => {
  it('tears down the encoder reads of that owner, also while the read-ahead window holds them', async () => {
    const proxy = rig({ maxDownloadMbps: 400 });
    const handle = await acquireSettled(proxy, 'gw://cut-active', 'session-1');
    const flowing = new Reader(handle.url, 100 * MB, 250 * MB - 1, true);
    await untilTrue(() => flowing.received > MB);
    const held = new Reader(handle.url, 120 * MB, 250 * MB - 1, true);
    handle.setLead(176);
    await sleep(300);

    handle.cutEncoderInput();

    await untilTrue(() => (flowing.closed || flowing.failed) && (held.closed || held.failed));
    expect(flowing.ended).toBe(false);
    expect(held.ended).toBe(false);
  }, 30_000);

  it('refuses new encoder reads of that owner until the next encoder start reopens the input', async () => {
    const proxy = rig({ maxDownloadMbps: 400 });
    const handle = await acquireSettled(proxy, 'gw://cut-refuse', 'session-1');

    handle.cutEncoderInput();
    const refused = new Reader(handle.url, 100 * MB, 100 * MB + 1023);
    await untilTrue(() => refused.closed);
    expect(refused.status).toBe(503);
    expect(refused.received).toBe(0);

    handle.resetReadAhead();
    const reopened = new Reader(handle.url, 100 * MB, 100 * MB + 1023);
    await untilTrue(() => reopened.ended);
    expect(reopened.status).toBe(206);
    expect(reopened.received).toBe(1024);
  }, 30_000);

  it('leaves the reads of other owners and of the extractor URL of the same owner alone', async () => {
    const proxy = rig({ maxDownloadMbps: 400 });
    const first = await acquireSettled(proxy, 'gw://cut-others', 'session-1');
    const second = await proxy.acquire('gw://cut-others', 'session-2');
    const otherEncoder = new Reader(second.url, 100 * MB, 250 * MB - 1);
    const extractor = new Reader(first.extractorRunUrl(1), 100 * MB, 250 * MB - 1);
    await untilTrue(() => otherEncoder.received > MB && extractor.received > 0);

    first.cutEncoderInput();
    await sleep(300);
    const before = [otherEncoder.received, extractor.received];
    await sleep(500);

    expect(otherEncoder.closed).toBe(false);
    expect(extractor.closed).toBe(false);
    expect(otherEncoder.received).toBeGreaterThan(before[0] as number);
  }, 30_000);

  it('does nothing once the handle is released', async () => {
    const proxy = rig({ maxDownloadMbps: 400 });
    const handle = await acquireSettled(proxy, 'gw://cut-released', 'session-1');
    handle.release();

    expect(() => handle.cutEncoderInput()).not.toThrow();
  }, 30_000);
});
