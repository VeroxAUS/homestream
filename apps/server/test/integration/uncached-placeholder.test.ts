import type { ActivityResponse, StreamsResponse } from '@homestream/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearSecrets } from '../../src/redact.js';
import { makeTempDir, removeDir } from '../helpers.js';
import {
  bootDownloadRig,
  makeFakes,
  seedUncachedMovie,
  type DownloadRig,
  type DownloadRigOptions,
  type FakeStream,
} from '../downloads/rig.js';

let root: string;
let rigs: DownloadRig[];

beforeEach(() => {
  root = makeTempDir('uncached-placeholder');
  rigs = [];
});

afterEach(async () => {
  for (const rig of rigs) await rig.close().catch(() => undefined);
  clearSecrets();
  removeDir(root);
});

async function bootWith(overrides: Partial<FakeStream>, options: DownloadRigOptions = {}): Promise<DownloadRig> {
  const fakes = options.fakes ?? makeFakes();
  seedUncachedMovie(fakes, overrides);
  const rig = await bootDownloadRig(root, { ...options, fakes });
  rigs.push(rig);
  return rig;
}

async function sessionCount(rig: DownloadRig): Promise<number> {
  return ((await rig.app.inject('/api/activity')).json() as ActivityResponse).sessions.length;
}

async function listedStreamId(rig: DownloadRig): Promise<string> {
  const list = (await rig.app.inject('/api/streams/movie/278')).json() as StreamsResponse;
  const first = list.streams[0];
  if (!first) throw new Error('the stub gateway listed no stream');
  return first.id;
}

const PLACEHOLDER_SHAPES = [
  ['downloading', 'a same-host redirect to the clip'],
  ['clip_other_host', 'a redirect to the clip on another host'],
  ['clip_relative_query', 'a relative redirect with a query string'],
  ['clip_two_hops', 'a two-hop redirect (gateway, intermediate host, clip)'],
  ['clip_200', 'a 200 clip far smaller than the listed size'],
  ['clip_206', 'a 206 clip far smaller than the listed size'],
] as const;

describe('auto start on an uncached stream (VAL-DL-001)', () => {
  it.each(PLACEHOLDER_SHAPES)('answers 202 for %s and creates no session', async (mode, _label) => {
    const rig = await bootWith({ mode });
    const { status, body } = await rig.play();
    expect(status).toBe(202);
    expect(body.status).toBe('downloading');
    expect(body.download).toMatchObject({ mediaType: 'movie', tmdbId: 278 });
    expect(await sessionCount(rig)).toBe(0);
    expect(rig.resolveCalls).toEqual([]);
    expect(rig.ofType('download.started')).toHaveLength(1);
    expect(rig.fakes.gateway.playbackCalls()).toHaveLength(1);
  });

  it('keeps a link that serves a file of the listed size playable', async () => {
    const rig = await bootWith({ mode: 'genuine_206' });
    const { status } = await rig.play();
    expect(status).not.toBe(202);
    expect(rig.fakes.gateway.playbackCalls()).toHaveLength(1);
    expect((await rig.app.inject('/api/downloads')).json()).toEqual({ downloads: [] });
  });

  it('does not take a short real title that lists a small size for a placeholder', async () => {
    const rig = await bootWith({ mode: 'clip_200', size: 3 * 1024 * 1024 });
    const { status } = await rig.play();
    expect(status).not.toBe(202);
    expect((await rig.app.inject('/api/downloads')).json()).toEqual({ downloads: [] });
  });
});

describe('explicit streamId on an uncached stream (VAL-STRM-015)', () => {
  it.each(PLACEHOLDER_SHAPES)('answers 202 for %s and never plays it', async (mode, _label) => {
    const rig = await bootWith({ mode });
    const streamId = await listedStreamId(rig);
    const { status, body } = await rig.play({ streamId });
    expect(status).toBe(202);
    expect(body.status).toBe('downloading');
    expect(await sessionCount(rig)).toBe(0);
    expect(rig.resolveCalls).toEqual([]);
    expect(rig.ofType('download.started')).toHaveLength(1);
  });

  it('reuses the pending download on a repeat and adds nothing', async () => {
    const rig = await bootWith({ mode: 'downloading' });
    const streamId = await listedStreamId(rig);
    const first = await rig.play({ streamId });
    const again = await rig.play({ streamId });
    expect(again.status).toBe(202);
    expect(again.body.download.id).toBe(first.body.download.id);
    expect(rig.fakes.gateway.playbackCalls()).toHaveLength(1);
  });

  it('turns a refused download into a clear error, still without a session', async () => {
    const rig = await bootWith({ mode: 'store_limit_exceeded' });
    const streamId = await listedStreamId(rig);
    const { status, body } = await rig.play({ streamId });
    expect(status).toBe(409);
    expect(body.error).toMatchObject({ code: 'torbox_slots_full', hint: expect.any(String) });
    expect(await sessionCount(rig)).toBe(0);
  });

  it('plays an explicit id of a cached stream without touching the download path', async () => {
    const rig = await bootWith({ cached: true, mode: 'downloading' });
    const streamId = await listedStreamId(rig);
    const { status } = await rig.play({ streamId });
    expect(status).not.toBe(202);
    expect(rig.resolveCalls).toHaveLength(1);
    expect(rig.fakes.gateway.playbackCalls()).toEqual([]);
    expect((await rig.app.inject('/api/downloads')).json()).toEqual({ downloads: [] });
  });

  it('still reports an unknown stream id as not found', async () => {
    const rig = await bootWith({ mode: 'downloading' });
    const { status, body } = await rig.play({ streamId: 'ffffffffffffffff' });
    expect(status).toBe(404);
    expect(body.error.code).toBe('stream_not_found');
    expect(rig.fakes.gateway.playbackCalls()).toEqual([]);
  });
});
