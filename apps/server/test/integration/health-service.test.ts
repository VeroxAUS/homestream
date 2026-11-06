import { HEALTH_CHECK_IDS, HealthResponseSchema, type HealthResponse } from '@homestream/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { logEvent } from '../../src/events/record.js';
import { clearSecrets } from '../../src/redact.js';
import { makeTempDir, removeDir } from '../helpers.js';
import { bootHealthRig, torboxAccount, type HealthRig } from '../health/rig.js';

const MINUTE = 60_000;
const NEEDLES = [
  'tmdb-test-token-123456',
  'torbox-key-abcdef123456',
  'gw.example.test',
  'aaaa1111',
  'bbbb2222cccc',
  'someone@example.com',
  'REFCODE1',
  'tb-cdn.io',
];

let root: string;
let rig: HealthRig;

beforeEach(() => {
  root = makeTempDir('health');
});
afterEach(async () => {
  await rig?.close();
  clearSecrets();
  removeDir(root);
});

const statuses = (body: HealthResponse): Record<string, string> =>
  Object.fromEntries(body.checks.map((check) => [check.id, check.status]));

async function boot(env: Record<string, string> = {}, envFile?: string): Promise<HealthRig> {
  rig = await bootHealthRig(root, { env: { TORBOX_API_KEY: 'torbox-key-abcdef123456', ...env }, envFile });
  return rig;
}

describe('GET /api/health on a healthy system', () => {
  it('returns all nine checks in the standard shape, all ok, overall ok', async () => {
    await boot();
    const body = await rig.health();
    expect(HealthResponseSchema.parse(body)).toEqual(body);
    expect(body.checks.map((check) => check.id)).toEqual([...HEALTH_CHECK_IDS]);
    expect(statuses(body)).toEqual(Object.fromEntries(HEALTH_CHECK_IDS.map((id) => [id, 'ok'])));
    expect(body.overall).toBe('ok');
    for (const check of body.checks) {
      expect(typeof check.latencyMs).toBe('number');
      expect(new Date(check.checkedAt).toISOString()).toBe(check.checkedAt);
      expect(check.details).toBeTypeOf('object');
      expect(check.hint).toBeUndefined();
    }
  });

  it('carries real details for the gateway, torbox, ffmpeg, gpu, disk, sessions and network checks', async () => {
    await boot();
    const body = await rig.health();
    expect(rig.check(body, 'gateway').details).toMatchObject({
      addon: { name: 'AIOStreams', version: '2.20.1' },
      url: 'aiostreams (redacted)',
    });
    expect(rig.check(body, 'torbox').details).toMatchObject({ plan: 'Essential', is_subscribed: true, daysLeft: 39 });
    expect(rig.check(body, 'ffmpeg').details).toMatchObject({
      ffmpegVersion: '9.0.2',
      h264_nvenc: true,
      hevc_nvenc: true,
      testEncode: { ok: true },
    });
    expect(rig.check(body, 'gpu').details).toMatchObject({ name: 'NVIDIA GeForce RTX 4080', temperatureC: 48 });
    expect(rig.check(body, 'disk').details).toMatchObject({ transcodeMaxGb: 20, transcodeUsageGb: 0 });
    expect(rig.check(body, 'sessions').details).toMatchObject({ active: 0, errorsLast15Min: 0 });
    expect(rig.check(body, 'network').details).toMatchObject({
      capMbps: 150,
      readAheadSec: 180,
      resumeSec: 120,
      rateMbps: 0,
      sessions: [],
    });
  });

  it('never calls the stream endpoint and asks the gateway for the manifest only', async () => {
    await boot();
    await rig.health();
    await rig.run();
    await rig.run('?fresh=1');
    const gatewayCalls = rig.fetched.filter((url) => !url.startsWith('https://api.torbox.app/'));
    expect(gatewayCalls.length).toBeGreaterThanOrEqual(3);
    for (const url of gatewayCalls) expect(url).toMatch(/\/manifest\.json$/);
    expect(gatewayCalls.some((url) => url.includes('/stream/'))).toBe(false);
  });

  it('keeps the network check live: two reads see different rates', async () => {
    await boot();
    await rig.health();
    const spy = vi.spyOn(rig.app.ctx.sourceProxy, 'network');
    const base = { capMbps: 150, readAheadSec: 180, resumeSec: 120, limitedForSec: 0 };
    spy.mockReturnValueOnce({ ...base, rateMbps: 12.5 }).mockReturnValueOnce({ ...base, rateMbps: 40 });
    const first = rig.check(await rig.health(), 'network');
    const second = rig.check(await rig.health(), 'network');
    expect(first.details.rateMbps).toBe(12.5);
    expect(second.details.rateMbps).toBe(40);
    expect(second.message).toBe('Downloading 40.0 of 150 Mbps.');
  });
});

describe('POST /api/health/run and caching', () => {
  it('refreshes tmdb and gateway, but torbox (5 min) and ffmpeg (10 min) keep their measured time', async () => {
    await boot();
    const first = await rig.health();
    rig.clock.advance(3000);
    const second = await rig.run();
    for (const id of ['tmdb', 'gateway', 'gpu', 'disk']) {
      expect(rig.check(second, id).checkedAt > rig.check(first, id).checkedAt).toBe(true);
    }
    for (const id of ['torbox', 'ffmpeg']) expect(rig.check(second, id).checkedAt).toBe(rig.check(first, id).checkedAt);
    expect(rig.fetched.filter((url) => url.startsWith('https://api.torbox.app/'))).toHaveLength(1);
    expect(rig.commands.filter((command) => command.includes('testsrc'))).toHaveLength(1);
  });

  it('refreshes torbox after 5 minutes and the NVENC test after 10', async () => {
    await boot();
    const first = await rig.health();
    rig.clock.advance(5 * MINUTE + 1000);
    const afterFive = await rig.run();
    expect(rig.check(afterFive, 'torbox').checkedAt > rig.check(first, 'torbox').checkedAt).toBe(true);
    expect(rig.check(afterFive, 'ffmpeg').checkedAt).toBe(rig.check(first, 'ffmpeg').checkedAt);
    rig.clock.advance(5 * MINUTE + 1000);
    const afterTen = await rig.run();
    expect(rig.check(afterTen, 'ffmpeg').checkedAt > rig.check(first, 'ffmpeg').checkedAt).toBe(true);
    expect(rig.check(afterTen, 'ffmpeg').details.testEncode).toMatchObject({ ok: true });
  });

  it('?fresh=1 bypasses both caches', async () => {
    await boot();
    const first = await rig.health();
    rig.clock.advance(2000);
    const fresh = await rig.run('?fresh=1');
    for (const id of ['torbox', 'ffmpeg'])
      expect(rig.check(fresh, id).checkedAt > rig.check(first, id).checkedAt).toBe(true);
    expect(rig.commands.filter((command) => command.includes('testsrc'))).toHaveLength(2);
  });

  it('does not run the NVENC test encode again while a session is encoding', async () => {
    await boot();
    await rig.health();
    vi.spyOn(rig.app.ctx.playback, 'activity').mockReturnValue([{} as never]);
    rig.clock.advance(11 * MINUTE);
    await rig.run();
    expect(rig.commands.filter((command) => command.includes('testsrc'))).toHaveLength(1);
  });

  it('does not cache a failed torbox answer, so a fixed key shows up on the next run', async () => {
    await boot();
    rig.torbox.status = 401;
    expect(rig.check(await rig.health(), 'torbox').status).toBe('error');
    rig.torbox.status = 200;
    expect(rig.check(await rig.run(), 'torbox').status).toBe('ok');
  });

  it('does not run the test encode when HEALTH_NVENC_TEST is off', async () => {
    await boot({ HEALTH_NVENC_TEST: 'off' });
    const ffmpeg = rig.check(await rig.health(), 'ffmpeg');
    expect(ffmpeg.status).toBe('ok');
    expect(ffmpeg.details.testEncode).toEqual({ ok: null, skipped: true });
    expect(rig.commands.some((command) => command.includes('testsrc'))).toBe(false);
  });
});

describe('induced failures', () => {
  it('a rejected TMDB token: tmdb error with a plain hint, others independent, overall error', async () => {
    await boot({ TMDB_READ_TOKEN: 'wrong-token-value-999' });
    const body = await rig.health();
    const tmdb = rig.check(body, 'tmdb');
    expect(tmdb.status).toBe('error');
    expect(tmdb.hint).toMatch(/TMDB_READ_TOKEN/);
    expect(JSON.stringify(body)).not.toContain('wrong-token-value-999');
    expect(statuses(body)).toMatchObject({
      config: 'ok',
      gateway: 'ok',
      torbox: 'ok',
      ffmpeg: 'ok',
      gpu: 'ok',
      disk: 'ok',
    });
    expect(body.overall).toBe('error');
    const home = await rig.app.inject('/api/home');
    expect(home.statusCode).toBeGreaterThanOrEqual(400);
    expect(home.json().error).toMatchObject({ code: expect.any(String), message: expect.any(String) });
  });

  it('an unreachable gateway: error with an unreachable hint that never echoes the host or id', async () => {
    await boot();
    rig.gateway.respond = () => Promise.reject(new TypeError('fetch failed: getaddrinfo ENOTFOUND gw.example.test'));
    const body = await rig.run('?fresh=1');
    const gateway = rig.check(body, 'gateway');
    expect(gateway.status).toBe('error');
    expect(gateway.hint).toMatch(/Gateway unreachable/);
    expect(JSON.stringify(gateway)).not.toMatch(/gw\.example|aaaa1111|bbbb2222/);
    expect(body.overall).toBe('error');
  });

  it('a bad TorBox key: torbox error with a hint, key not echoed, error event for source torbox', async () => {
    await boot();
    rig.torbox.status = 401;
    const body = await rig.health();
    const torbox = rig.check(body, 'torbox');
    expect(torbox).toMatchObject({ status: 'error', hint: expect.stringContaining('torbox.app') });
    expect(JSON.stringify(body)).not.toContain('torbox-key-abcdef123456');
    expect(statuses(body)).toMatchObject({ tmdb: 'ok', gateway: 'ok', ffmpeg: 'ok' });
    const logs = (await rig.app.inject('/api/logs?source=torbox')).json();
    expect(logs.events).toEqual([
      expect.objectContaining({ level: 'error', source: 'torbox', message: expect.stringContaining('TorBox') }),
    ]);
  });

  it('a missing ffmpeg: ffmpeg error naming FFMPEG_PATH, the server keeps answering', async () => {
    await boot({ FFMPEG_PATH: 'C:\\nowhere\\ffmpeg.exe' });
    rig.runResults.ffmpegVersion = { code: null, stdout: '', stderr: '', failure: 'ENOENT' };
    const body = await rig.health();
    const ffmpeg = rig.check(body, 'ffmpeg');
    expect(ffmpeg.status).toBe('error');
    expect(ffmpeg.hint).toContain('FFMPEG_PATH');
    expect(body.overall).toBe('error');
    expect((await rig.app.inject('/api/info')).statusCode).toBe(200);
  });

  it('missing keys: config error names the keys (no values) and the config file path', async () => {
    await boot({}, 'SERVER_NAME=x\n');
    const body = await rig.health();
    const config = rig.check(body, 'config');
    expect(config.status).toBe('error');
    expect(config.message).toMatch(/GATEWAY_MANIFEST_URL.*TMDB_READ_TOKEN/);
    expect(config.hint).toContain(rig.app.ctx.config.configFile.path);
    expect(rig.check(body, 'gateway').status).toBe('error');
    expect(rig.check(body, 'tmdb').status).toBe('error');
    expect(config.details.keys).toContainEqual({ name: 'TORBOX_API_KEY', required: false, present: true });
  });

  it('an invalid download setting: the server starts, the network check shows the default, config warns', async () => {
    await boot({ MAX_DOWNLOAD_MBPS: 'abc', READ_AHEAD_SEC: '0' });
    const body = await rig.health();
    expect(rig.check(body, 'network').details).toMatchObject({ capMbps: 150, readAheadSec: 180, resumeSec: 120 });
    expect(rig.check(body, 'config')).toMatchObject({ status: 'warn', hint: expect.stringContaining('restart') });
  });

  it('low disk space warns, very low is an error, both with hints', async () => {
    await boot();
    rig.freeGb.transcode = 12;
    expect(rig.check(await rig.run(), 'disk')).toMatchObject({ status: 'warn', hint: expect.any(String) });
    rig.freeGb.transcode = 3;
    const body = await rig.run();
    expect(rig.check(body, 'disk')).toMatchObject({ status: 'error', hint: expect.any(String) });
    expect(body.overall).toBe('error');
  });

  it('a hot GPU warns', async () => {
    await boot();
    rig.runResults.gpu = { code: 0, stdout: 'NVIDIA GeForce RTX 4080, 581.29, 99, 80, 9000, 16376, 88\n', stderr: '' };
    expect(rig.check(await rig.run(), 'gpu')).toMatchObject({ status: 'warn', hint: expect.any(String) });
  });
});

describe('sessions check', () => {
  it('counts playback errors from the last 15 minutes but not the health checks own events', async () => {
    await boot();
    const deps = { db: rig.app.ctx.db, bus: rig.app.ctx.bus };
    logEvent(deps, { level: 'error', source: 'health', message: 'x', details: { check: 'ffmpeg' } });
    logEvent(deps, {
      level: 'error',
      source: 'ffmpeg',
      message: 'ffmpeg own health event',
      details: { check: 'ffmpeg' },
    });
    expect(rig.check(await rig.run(), 'sessions').status).toBe('ok');
    logEvent(deps, {
      level: 'error',
      source: 'session',
      message: 'The stream link stopped working.',
      sessionId: 'abc',
    });
    const sessions = rig.check(await rig.run(), 'sessions');
    expect(sessions).toMatchObject({ status: 'warn', details: { errorsLast15Min: 1 } });
    expect(sessions.details.recentErrors).toEqual([expect.objectContaining({ source: 'session', sessionId: 'abc' })]);
  });

  it('uses the manager list of falling-behind sessions, so waiting sessions never warn', async () => {
    await boot();
    const spy = vi.spyOn(rig.app.ctx.playback, 'fallingBehindSessions').mockReturnValue([]);
    expect(rig.check(await rig.run(), 'sessions').status).toBe('ok');
    spy.mockReturnValue(['sess-1']);
    expect(rig.check(await rig.run(), 'sessions')).toMatchObject({
      status: 'warn',
      details: { fallingBehind: ['sess-1'] },
    });
  });

  it('reports the active count of GET /api/activity', async () => {
    await boot();
    const active = (await rig.app.inject('/api/activity')).json().sessions.length;
    expect(rig.check(await rig.run(), 'sessions').details.active).toBe(active);
  });
});

describe('status changes', () => {
  it('log one event per change, push a health snapshot and stay quiet when nothing changes', async () => {
    await boot();
    const healthEvents: HealthResponse[] = [];
    rig.app.ctx.bus.subscribe((event) => {
      if (event.type === 'health') healthEvents.push(event.data as unknown as HealthResponse);
    });
    await rig.health();
    healthEvents.length = 0;

    rig.runResults.gpu = { code: 0, stdout: 'NVIDIA GeForce RTX 4080, 581.29, 99, 80, 9000, 16376, 90\n', stderr: '' };
    await rig.run();
    await rig.run();
    const warn = (await rig.app.inject('/api/logs?level=warn')).json().events;
    expect(warn.filter((event: { message: string }) => event.message.startsWith('GPU:'))).toHaveLength(1);
    expect(healthEvents.length).toBe(2);
    expect(healthEvents[0]?.overall).toBe('warn');
    expect(healthEvents[0]?.checks.map((check) => check.id)).toEqual([...HEALTH_CHECK_IDS]);

    rig.runResults.gpu = { code: 0, stdout: 'NVIDIA GeForce RTX 4080, 581.29, 5, 0, 2000, 16376, 50\n', stderr: '' };
    await rig.run();
    const info = (await rig.app.inject('/api/logs?level=info&source=health')).json().events;
    expect(info[0].message).toMatch(/^GPU is ok again/);
  });

  it('a manual run always pushes the snapshot, even without a change', async () => {
    await boot();
    await rig.health();
    const seen: string[] = [];
    rig.app.ctx.bus.subscribe((event) => seen.push(event.type));
    await rig.run();
    expect(seen).toContain('health');
  });

  it('records a start-up problem once', async () => {
    await boot();
    rig.torbox.status = 401;
    await rig.health();
    await rig.run();
    await rig.run();
    expect((await rig.app.inject('/api/logs?source=torbox')).json().events).toHaveLength(1);
  });
});

describe('secret audit of health, logs and events', () => {
  it('shows none of the secrets, hosts or personal fields anywhere after failures were induced', async () => {
    await boot();
    rig.torbox.status = 401;
    rig.tmdb.failWith = 'network';
    rig.gateway.respond = () =>
      Promise.reject(new TypeError('fetch failed https://gw.example.test/stremio/aaaa1111/bbbb2222cccc/manifest.json'));
    logEvent(
      { db: rig.app.ctx.db, bus: rig.app.ctx.bus },
      {
        level: 'error',
        source: 'session',
        message: 'link https://store-1.wnam.tb-cdn.io/dl/x?token=abc123 bearer torbox-key-abcdef123456',
        details: { url: 'https://gw.example.test/stremio/aaaa1111/bbbb2222cccc/stream/movie/tt1.json' },
      },
    );
    const outputs = [
      JSON.stringify(await rig.run('?fresh=1')),
      JSON.stringify(await rig.health()),
      (await rig.app.inject('/api/logs?limit=1000')).body,
      JSON.stringify(rig.app.ctx.db.prepare('SELECT message, details_json FROM events').all()),
    ];
    rig.torbox.body = torboxAccount();
    for (const output of outputs) for (const needle of NEEDLES) expect(output, needle).not.toContain(needle);
  });
});
