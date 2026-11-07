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

  it('keeps each session on its own window when two sessions play the same stream', async () => {
    const proxy = rig({ maxDownloadMbps: 400 });
    const first = await proxy.acquire('gw://shared', 'session-1');
    const second = await proxy.acquire('gw://shared', 'session-2');
    first.setLead(180);
    expect(first.readAhead).toBe('waiting');
    second.setLead(5);
    expect(first.readAhead).toBe('waiting');
    expect(second.readAhead).toBe('filling');
    expect(first.leadSec).toBe(180);
    expect(second.leadSec).toBe(5);
    second.resetReadAhead();
    expect(first.readAhead).toBe('waiting');
    second.setLead(177);
    expect(second.readAhead).toBe('waiting');
    second.release();
    expect(first.readAhead).toBe('waiting');
    first.setLead(100);
    expect(first.readAhead).toBe('filling');
  }, 30_000);

  it('stops the paused session reader while another session on the same stream keeps downloading', async () => {
    const proxy = rig({ maxDownloadMbps: 400 });
    const paused = await acquireSettled(proxy, 'gw://two', 'session-1');
    const playing = await proxy.acquire('gw://two', 'session-2');
    expect(paused.url).not.toBe(playing.url);

    paused.setLead(180);
    playing.setLead(5);
    const pausedReader = new Reader(paused.url, 100 * MB, 250 * MB - 1);
    const playingReader = new Reader(playing.url, 260 * MB, 300 * MB - 1);
    await expect.poll(() => playingReader.ended, { timeout: 15_000 }).toBe(true);
    expect(pausedReader.received).toBe(0);
    expect(pausedReader.closed).toBe(false);
    expect(paused.readAhead).toBe('waiting');
    expect(playing.readAhead).toBe('filling');

    playing.resetReadAhead();
    await sleep(300);
    expect(pausedReader.received).toBe(0);

    paused.setLead(100);
    await expect.poll(() => pausedReader.ended, { timeout: 15_000 }).toBe(true);
    expect(pausedReader.received).toBe(150 * MB);
  }, 40_000);

  it('does not let a session that never reported a lead be held by another session', async () => {
    const proxy = rig({ maxDownloadMbps: 400 });
    const first = await acquireSettled(proxy, 'gw://third', 'session-1');
    const second = await proxy.acquire('gw://third', 'session-2');
    first.setLead(180);
    const reader = new Reader(second.url, 100 * MB, 110 * MB - 1);
    await expect.poll(() => reader.ended, { timeout: 15_000 }).toBe(true);
    expect(reader.received).toBe(10 * MB);
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

  it('keeps extractor run ids of two sessions on the same source apart', async () => {
    const proxy = rig({ maxDownloadMbps: 400 });
    const first = await acquireSettled(proxy, 'gw://run-ids', 'session-1');
    const second = await proxy.acquire('gw://run-ids', 'session-2');
    expect(first.extractorRunUrl(1)).not.toBe(second.extractorRunUrl(1));

    first.setExtractorHold(1, true);
    const heldFirst = new Reader(first.extractorRunUrl(1), 100 * MB, 120 * MB - 1);
    const freeSecond = new Reader(second.extractorRunUrl(1), 200 * MB, 210 * MB - 1);
    await expect.poll(() => freeSecond.ended, { timeout: 15_000 }).toBe(true);
    expect(heldFirst.received).toBe(0);

    second.setExtractorHold(1, true);
    second.setExtractorHold(1, false);
    await sleep(300);
    expect(heldFirst.received).toBe(0);

    second.release();
    await sleep(300);
    expect(heldFirst.received).toBe(0);

    first.setExtractorHold(1, false);
    await expect.poll(() => heldFirst.ended, { timeout: 15_000 }).toBe(true);
    expect(heldFirst.received).toBe(20 * MB);
  }, 40_000);
});
