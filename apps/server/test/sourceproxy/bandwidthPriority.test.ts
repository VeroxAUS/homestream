import { describe, expect, it } from 'vitest';
import { MB, Reader, acquireSettled, installRigHooks, rig, sleep } from './bandwidthRig.js';

installRigHooks();

describe('download priority', () => {
  it('gives the cap to the source with the smaller lead first', async () => {
    const proxy = rig({ maxDownloadMbps: 40 });
    const far = await acquireSettled(proxy, 'gw://far', 'session-far');
    const near = await acquireSettled(proxy, 'gw://near', 'session-near');
    far.setLead(120);
    near.setLead(8);
    const farReader = new Reader(far.url, 100 * MB, '');
    const nearReader = new Reader(near.url, 100 * MB, '');
    await sleep(6000);
    expect(nearReader.received).toBeGreaterThan(farReader.received * 2);
    expect(near.rateMbps()).toBeGreaterThan(far.rateMbps());
  }, 60_000);

  it('serves the extractor after the encoders when the cap binds', async () => {
    const proxy = rig({ maxDownloadMbps: 40 });
    const handle = await acquireSettled(proxy, 'gw://order', 'session-1');
    handle.setLead(30);
    const encoder = new Reader(handle.url, 100 * MB, '');
    const extractor = new Reader(handle.extractorUrl, 250 * MB, '');
    await sleep(6000);
    expect(encoder.received).toBeGreaterThan(extractor.received * 2);
    expect(extractor.received).toBeGreaterThan(0);
  }, 60_000);
});

