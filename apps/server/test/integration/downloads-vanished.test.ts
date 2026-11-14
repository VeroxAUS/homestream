import { DownloadFailedEventSchema, DownloadStartedResponseSchema, type Download } from '@homestream/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearSecrets } from '../../src/redact.js';
import { makeTempDir, removeDir } from '../helpers.js';
import {
  GATEWAY_ORIGIN,
  MOVIE_HASH,
  TORBOX_KEY,
  bootDownloadRig,
  makeFakes,
  seedUncachedMovie,
  type DownloadRig,
  type DownloadRigOptions,
  type FakeStream,
} from '../downloads/rig.js';

const MIN = 60_000;
const HOUR = 60 * MIN;

let root: string;
let rigs: DownloadRig[];

beforeEach(() => {
  root = makeTempDir('downloads-vanished');
  rigs = [];
});

afterEach(async () => {
  for (const rig of rigs) await rig.close().catch(() => undefined);
  clearSecrets();
  removeDir(root);
});

async function boot(
  options: DownloadRigOptions = {},
  seed: Partial<FakeStream> = {},
): Promise<{ rig: DownloadRig; stream: FakeStream }> {
  const fakes = options.fakes ?? makeFakes();
  const stream = seedUncachedMovie(fakes, seed);
  const rig = await bootDownloadRig(root, { ...options, fakes });
  rigs.push(rig);
  return { rig, stream };
}

const item = (progress: number, extra: Record<string, unknown> = {}) => ({
  hash: MOVIE_HASH,
  name: 'Movie.1994.1080p',
  download_state: 'downloading',
  progress,
  eta: 120,
  download_finished: false,
  download_present: false,
  ...extra,
});

/** One minute at a time, like the poller's own cadence. */
async function poll(rig: DownloadRig, minutes: number): Promise<void> {
  for (let i = 0; i < minutes; i += 1) {
    rig.fakes.clock.advance(MIN);
    await rig.tick();
  }
}

async function listed(rig: DownloadRig): Promise<Download> {
  const body = (await rig.app.inject('/api/downloads')).json() as { downloads: Download[] };
  return body.downloads[0] as Download;
}

async function downloadLogs(rig: DownloadRig): Promise<Array<{ message: string; level: string }>> {
  const body = (await rig.app.inject('/api/logs?source=downloads&limit=200')).json() as {
    events: Array<{ message: string; level: string }>;
  };
  return body.events;
}

/** Everything that proves the poller is still looking at this download. */
const activity = (rig: DownloadRig): number[] => [
  rig.fakes.torbox.calls.length,
  rig.fakes.gateway.calls.length,
  rig.events.length,
];

async function expectFailedAndQuiet(rig: DownloadRig, reason: string): Promise<void> {
  const failed = rig.ofType('download.failed');
  expect(failed).toHaveLength(1);
  const payload = DownloadFailedEventSchema.parse(failed[0]?.data);
  expect(payload.reason).toBe(reason);
  expect(payload.message).toMatch(/Try Play again/);
  expect(payload.message).not.toMatch(/https?:|[0-9a-f]{40}/);
  expect(await listed(rig)).toMatchObject({ status: 'failed', state: 'failed', reason });
  const warns = (await downloadLogs(rig)).filter((entry) => entry.level === 'warn');
  expect(warns).toHaveLength(1);
  expect(warns[0]?.message).toContain(payload.message);

  const before = activity(rig);
  await poll(rig, 5);
  expect(activity(rig)).toEqual(before);
}

describe('a vanished TorBox item (VAL-DL-010 a, b)', () => {
  it('fails 10 minutes after the first poll that missed a hash TorBox never listed', async () => {
    const { rig } = await boot();
    await rig.play();
    await poll(rig, 10);
    // First missed poll at 1 min; 9 minutes of absence so far.
    expect((await listed(rig)).status).toBe('pending');
    expect(rig.ofType('download.failed')).toEqual([]);
    await poll(rig, 1);
    await expectFailedAndQuiet(rig, 'vanished');
  });

  it('fails 10 minutes after a listed item disappears, not earlier', async () => {
    const { rig } = await boot();
    await rig.play();
    rig.fakes.torbox.items = [item(0.2)];
    await poll(rig, 3);
    expect(await listed(rig)).toMatchObject({ state: 'downloading', progress: 0.2 });

    rig.fakes.torbox.items = [];
    await poll(rig, 10);
    expect((await listed(rig)).status).toBe('pending');
    expect(rig.ofType('download.failed')).toEqual([]);
    await poll(rig, 1);
    await expectFailedAndQuiet(rig, 'vanished');
  });

  it('lets a new Play start over after the failure', async () => {
    const { rig } = await boot();
    const first = (await rig.play()).body.download;
    await poll(rig, 11);
    expect(rig.ofType('download.failed')).toHaveLength(1);
    const again = await rig.play();
    expect(again.status).toBe(202);
    expect(again.body.download.id).not.toBe(first.id);
  });

  it('resets the timer when the item reappears before the limit', async () => {
    const { rig } = await boot();
    await rig.play();
    await poll(rig, 6);
    rig.fakes.torbox.items = [item(0.1)];
    await poll(rig, 1);
    expect(await listed(rig)).toMatchObject({ state: 'downloading' });

    rig.fakes.torbox.items = [];
    // The original deadline (11 min after the add) passes without a failure.
    await poll(rig, 10);
    expect(rig.ofType('download.failed')).toEqual([]);
    expect((await listed(rig)).status).toBe('pending');
    await poll(rig, 1);
    await expectFailedAndQuiet(rig, 'vanished');
  });

  it('keeps counting the absence across a restart', async () => {
    const fakes = makeFakes();
    const { rig: first } = await boot({ fakes });
    const started = (await first.play()).body.download;
    await poll(first, 6);
    await first.close();

    const { rig: second } = await boot({ fakes });
    expect((await listed(second)).id).toBe(started.id);
    await poll(second, 4);
    expect((await listed(second)).status).toBe('pending');
    await poll(second, 1);
    expect(second.ofType('download.failed')).toHaveLength(1);
  });

  it('does not count a TorBox outage as absence', async () => {
    const { rig } = await boot();
    await rig.play();
    rig.fakes.torbox.failNetwork = true;
    await poll(rig, 30);
    expect(rig.ofType('download.failed')).toEqual([]);
    expect((await listed(rig)).status).toBe('pending');
  });

  it('still becomes ready when the gateway lists a cached stream while TorBox does not list the item', async () => {
    const { rig, stream } = await boot();
    await rig.play();
    await poll(rig, 4);
    stream.cached = true;
    await poll(rig, 2);
    expect(rig.ofType('download.ready')).toHaveLength(1);
    expect(rig.ofType('download.failed')).toEqual([]);
    expect((await listed(rig)).status).toBe('ready');
  });
});

describe('an item stuck in metaDL (VAL-DL-010 c, d)', () => {
  const meta = (progress = 0) => item(progress, { download_state: 'metaDL', eta: 0 });

  it('fails after 30 minutes in metaDL, still pending at 29', async () => {
    const { rig } = await boot();
    await rig.play();
    rig.fakes.torbox.items = [meta()];
    // First metaDL poll at 1 min.
    await poll(rig, 30);
    expect((await listed(rig)).status).toBe('pending');
    expect(rig.ofType('download.failed')).toEqual([]);
    await poll(rig, 1);
    await expectFailedAndQuiet(rig, 'metadata_stuck');
  });

  it('restarts the timer when the state leaves metaDL', async () => {
    const { rig } = await boot();
    await rig.play();
    rig.fakes.torbox.items = [meta()];
    await poll(rig, 20);
    rig.fakes.torbox.items = [item(0)];
    await poll(rig, 1);
    rig.fakes.torbox.items = [meta()];
    await poll(rig, 30);
    expect(rig.ofType('download.failed')).toEqual([]);
    await poll(rig, 1);
    await expectFailedAndQuiet(rig, 'metadata_stuck');
  });

  it('restarts the timer when the progress rises', async () => {
    const { rig } = await boot();
    await rig.play();
    rig.fakes.torbox.items = [meta()];
    await poll(rig, 25);
    rig.fakes.torbox.items = [meta(0.02)];
    await poll(rig, 30);
    expect(rig.ofType('download.failed')).toEqual([]);
    await poll(rig, 1);
    await expectFailedAndQuiet(rig, 'metadata_stuck');
  });

  it('forgets a metaDL timer when the item vanishes and comes back', async () => {
    const { rig } = await boot();
    await rig.play();
    rig.fakes.torbox.items = [meta()];
    await poll(rig, 25);
    rig.fakes.torbox.items = [];
    await poll(rig, 3);
    rig.fakes.torbox.items = [meta()];
    await poll(rig, 30);
    expect(rig.ofType('download.failed')).toEqual([]);
    await poll(rig, 1);
    expect(rig.ofType('download.failed')[0]?.data).toMatchObject({ reason: 'metadata_stuck' });
  });
});

describe('the other rules are unchanged (VAL-DL-010 e)', () => {
  it('still gives up on a stalled item only after 6 hours without progress', async () => {
    const { rig } = await boot();
    await rig.play();
    rig.fakes.torbox.items = [item(0.1, { download_state: 'stalled (no seeds)' })];
    await poll(rig, 1);
    rig.fakes.clock.advance(5 * HOUR);
    await rig.tick();
    expect(rig.ofType('download.failed')).toEqual([]);
    rig.fakes.clock.advance(HOUR);
    await rig.tick();
    expect(rig.ofType('download.failed')[0]?.data).toMatchObject({ reason: 'stalled' });
  });

  it('does not fail a slowly progressing item before the 24 hour limit', async () => {
    const { rig } = await boot({ limits: { fastPollMs: 5 * MIN, slowPollMs: 5 * MIN } });
    await rig.play();
    let progress = 0.01;
    for (let minutes = 0; minutes < 23 * 60; minutes += 5) {
      progress += 0.0001;
      rig.fakes.torbox.items = [item(progress)];
      rig.fakes.clock.advance(5 * MIN);
      await rig.tick();
    }
    expect(rig.ofType('download.failed')).toEqual([]);
    rig.fakes.clock.advance(HOUR + 6 * MIN);
    await rig.tick();
    expect(rig.ofType('download.failed')[0]?.data).toMatchObject({ reason: 'timeout' });
  });

  it('never applies the 10 minute rule without a TorBox key', async () => {
    const { rig } = await boot({ torboxKey: false });
    await rig.play();
    await poll(rig, 30);
    expect(rig.ofType('download.failed')).toEqual([]);
    expect(rig.fakes.torbox.calls).toEqual([]);
  });

  it('never applies the 10 minute rule to a release without an info hash', async () => {
    const { rig } = await boot({}, { infoHash: undefined });
    const { status } = await rig.play();
    expect(status).toBe(202);
    await poll(rig, 30);
    expect(rig.ofType('download.failed')).toEqual([]);
    expect(rig.fakes.torbox.calls).toEqual([]);
    expect((await listed(rig)).status).toBe('pending');
  });
});

describe('a probe timeout is not reported as accepted (VAL-DL-011)', () => {
  const FORBIDDEN = /accepted|started downloading|assuming it is downloading/i;

  it('answers 202 downloading/pending and says the request was sent but not confirmed', async () => {
    const { rig } = await boot({ playbackTimeoutMs: 60 }, { mode: 'hang' });
    const { status, body } = await rig.play();
    expect(status).toBe(202);
    expect(DownloadStartedResponseSchema.parse(body)).toEqual(body);
    expect(body.status).toBe('downloading');
    expect(body.download.state).toBe('pending');
    expect(rig.ofType('download.started')).toHaveLength(1);

    const messages = (await downloadLogs(rig)).map((entry) => entry.message);
    expect(messages).toContain(
      `Sent "${(await listed(rig)).title}" to TorBox, but it did not confirm in time; HomeStream will keep checking.`,
    );
    for (const message of messages) expect(message).not.toMatch(FORBIDDEN);
    const stored = JSON.stringify(rig.app.ctx.db.prepare('SELECT message, details_json FROM events').all());
    expect(stored).not.toMatch(FORBIDDEN);
    expect(JSON.stringify([...rig.events, body])).not.toMatch(FORBIDDEN);
    expect(stored + JSON.stringify(body)).not.toContain(GATEWAY_ORIGIN);
    expect(stored).not.toContain('tokenA');
    expect(stored).not.toContain(TORBOX_KEY);
  });

  it('keeps polling for the hash and moves to downloading when TorBox lists it', async () => {
    const { rig } = await boot({ playbackTimeoutMs: 60 }, { mode: 'hang' });
    await rig.play();
    await poll(rig, 3);
    expect(rig.fakes.torbox.calls).toHaveLength(3);
    expect(await listed(rig)).toMatchObject({ state: 'pending' });
    rig.fakes.torbox.items = [item(0.3)];
    await poll(rig, 1);
    expect(await listed(rig)).toMatchObject({ state: 'downloading', progress: 0.3 });
  });

  it('fails as vanished when TorBox never lists the item', async () => {
    const { rig } = await boot({ playbackTimeoutMs: 60 }, { mode: 'hang' });
    await rig.play();
    await poll(rig, 11);
    expect(rig.ofType('download.failed')[0]?.data).toMatchObject({ reason: 'vanished' });
  });

  it('keeps the accepted wording when the gateway answers with the downloading clip', async () => {
    const { rig } = await boot();
    const { status } = await rig.play();
    expect(status).toBe(202);
    const messages = (await downloadLogs(rig)).map((entry) => entry.message);
    expect(messages.some((message) => /TorBox accepted ".+" and started downloading it\./.test(message))).toBe(true);
    expect(messages.join('\n')).not.toMatch(/did not confirm/);
  });
});
