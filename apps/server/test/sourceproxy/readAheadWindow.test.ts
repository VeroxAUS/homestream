import { describe, expect, it } from 'vitest';
import { MB, Reader, acquireSettled, cdn, installRigHooks, rig, sleep } from './bandwidthRig.js';

installRigHooks();

describe('read-ahead window', () => {
  it('stops upstream reads at the window, keeps the reader connected, and resumes below the resume lead with intact bytes', async () => {
    const proxy = rig({ maxDownloadMbps: 400 });
    const handle = await acquireSettled(proxy, 'gw://window', 'session-1');
    const reader = new Reader(handle.url, 100 * MB, 250 * MB - 1, true);

    handle.setLead(10);
    await sleep(600);
    expect(handle.readAhead).toBe('filling');
    expect(reader.received).toBeGreaterThan(5 * MB);

    // 176 s is the finished-segment lead at which the window closes (ffmpeg holds about 4 s more).
    handle.setLead(176);
    expect(handle.readAhead).toBe('waiting');
    await sleep(500);
    const frozen = reader.received;
    const sent = cdn.sentBytes;
    await sleep(3000);
    expect(reader.received).toBe(frozen);
    expect(cdn.sentBytes - sent).toBeLessThan(256 * 1024);
    expect(reader.ended || reader.failed || reader.closed).toBe(false);

    // Between the two points the window stays shut.
    handle.setLead(150);
    expect(handle.readAhead).toBe('waiting');
    await sleep(500);
    expect(reader.received).toBe(frozen);

    handle.setLead(119);
    expect(handle.readAhead).toBe('filling');
    await expect.poll(() => reader.received, { timeout: 5000 }).toBeGreaterThan(frozen + 5 * MB);
    while (!reader.ended && !reader.failed) await sleep(50);
    expect(reader.ended).toBe(true);
    expect(reader.received).toBe(150 * MB);
    expect(reader.matches()).toBe(true);
  }, 60_000);

  it('opens the window again at an encoder start or seek', async () => {
    const proxy = rig({ maxDownloadMbps: 400 });
    const handle = await acquireSettled(proxy, 'gw://reset', 'session-1');
    handle.setLead(176);
    expect(handle.readAhead).toBe('waiting');
    const reader = new Reader(handle.url, 100 * MB, '');
    await sleep(500);
    expect(reader.received).toBe(0);
    handle.resetReadAhead();
    expect(handle.readAhead).toBe('filling');
    await expect.poll(() => reader.received, { timeout: 5000 }).toBeGreaterThan(5 * MB);
  }, 30_000);

  it('does not download for a paused player: no upstream bytes while the window is shut', async () => {
    const proxy = rig({ maxDownloadMbps: 60 });
    const handle = await acquireSettled(proxy, 'gw://paused', 'session-1');
    new Reader(handle.url, 100 * MB, '');
    await sleep(700);
    handle.setLead(180);
    await sleep(700);
    const sent = cdn.sentBytes;
    await sleep(6000);
    expect(cdn.sentBytes - sent).toBeLessThan(256 * 1024);
    expect(proxy.network().rateMbps).toBeLessThan(2);
  }, 30_000);

  it('uses the smallest lead when two sessions play the same stream', async () => {
    const proxy = rig({ maxDownloadMbps: 400 });
    const first = await proxy.acquire('gw://shared', 'session-1');
    const second = await proxy.acquire('gw://shared', 'session-2');
    first.setLead(180);
    expect(first.readAhead).toBe('waiting');
    second.setLead(5);
    expect(first.readAhead).toBe('filling');
    second.setLead(177);
    expect(second.readAhead).toBe('waiting');
    second.release();
    first.setLead(100);
    expect(first.readAhead).toBe('filling');
  }, 30_000);

  it('holds only the extractor run that was told to wait', async () => {
    const proxy = rig({ maxDownloadMbps: 400 });
    const handle = await acquireSettled(proxy, 'gw://runs', 'session-1');
    handle.setExtractorHold(1, true);
    const held = new Reader(handle.extractorRunUrl(1), 100 * MB, 150 * MB - 1);
    const other = new Reader(handle.extractorRunUrl(2), 200 * MB, 210 * MB - 1);
    const plain = new Reader(handle.extractorUrl, 220 * MB, 230 * MB - 1);
    const encoder = new Reader(handle.url, 240 * MB, 250 * MB - 1);
    await expect.poll(() => other.ended && plain.ended && encoder.ended, { timeout: 15_000 }).toBe(true);
    expect(held.received).toBe(0);
    expect(held.closed).toBe(false);

    handle.setExtractorHold(1, false);
    await expect.poll(() => held.ended, { timeout: 15_000 }).toBe(true);
    expect(held.received).toBe(50 * MB);
  }, 40_000);
});

