import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkConfig } from '../../src/health/checks/config.js';
import { checkFfmpeg, parseEncoders, parseVersion } from '../../src/health/checks/ffmpeg.js';
import { checkGateway, type HealthFetch } from '../../src/health/checks/gateway.js';
import { checkGpu, parseGpuCsv } from '../../src/health/checks/gpu.js';
import { checkSessions } from '../../src/health/checks/sessions.js';
import { checkTmdb } from '../../src/health/checks/tmdb.js';
import { checkTorbox } from '../../src/health/checks/torbox.js';
import type { CommandResult, CommandRunner } from '../../src/health/exec.js';
import { AppError } from '../../src/errors.js';
import { testConfig, makeTempDir, removeDir } from '../helpers.js';
import { clearSecrets } from '../../src/redact.js';

const NOW = Date.UTC(2026, 10, 6, 12, 0, 0);
const DAY = 24 * 3600 * 1000;
const CONFIG_FILE = { path: 'C:\\cfg\\config.env', exists: true, source: 'env' as const };

let root: string;
beforeAll(() => {
  root = makeTempDir('health-checks');
});
afterAll(() => {
  clearSecrets();
  removeDir(root);
});

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status });

describe('checkConfig', () => {
  it('lists keys by name with present flags and the config path, never a value', () => {
    const config = testConfig(root, { TORBOX_API_KEY: 'torbox-secret-key-123456' });
    const outcome = checkConfig(config);
    expect(outcome.status).toBe('ok');
    expect(outcome.details.keys).toEqual([
      { name: 'GATEWAY_MANIFEST_URL', required: true, present: true },
      { name: 'TMDB_READ_TOKEN', required: true, present: true },
      { name: 'TORBOX_API_KEY', required: false, present: true },
    ]);
    expect(outcome.details.configFile).toBe(config.configFile.path);
    const text = JSON.stringify(outcome);
    for (const secret of ['tmdb-test-token-123456', 'torbox-secret-key-123456', 'aaaa1111', 'gw.example.test'])
      expect(text).not.toContain(secret);
  });

  it('is an error naming every missing required key and the config file to edit', () => {
    const config = testConfig(root, {}, 'SERVER_NAME=x\n');
    const outcome = checkConfig(config);
    expect(outcome.status).toBe('error');
    expect(outcome.message).toContain('GATEWAY_MANIFEST_URL');
    expect(outcome.message).toContain('TMDB_READ_TOKEN');
    expect(outcome.hint).toContain(config.configFile.path);
    expect(outcome.hint).toMatch(/restart/i);
  });

  it('warns about invalid optional settings that fell back to defaults', () => {
    const config = testConfig(root, { MAX_DOWNLOAD_MBPS: 'abc' });
    const outcome = checkConfig(config);
    expect(outcome.status).toBe('warn');
    expect(outcome.hint).toContain(config.configFile.path);
    expect(JSON.stringify(outcome.details.warnings)).toContain('MAX_DOWNLOAD_MBPS');
  });
});

describe('checkGateway', () => {
  const stats = { requests: 4, errors: 1, lastLatencyMs: 5200, lastLookupAt: NOW - 1000, lastError: null };
  const config = {
    gatewayManifestUrl: 'https://abc.example.test/stremio/u1/tok2/manifest.json',
    configFile: CONFIG_FILE,
  };

  it('reads the manifest only and reports addon, redacted label and lookup counters', async () => {
    const urls: string[] = [];
    const fetch: HealthFetch = async (url) => {
      urls.push(url);
      return json({ name: 'AIOStreams', version: '2.20.1' });
    };
    const outcome = await checkGateway({ config, stats, fetch });
    expect(urls).toEqual([config.gatewayManifestUrl]);
    expect(outcome.status).toBe('ok');
    expect(outcome.details).toMatchObject({
      url: 'aiostreams (redacted)',
      addon: { name: 'AIOStreams', version: '2.20.1' },
      lookups: 4,
      lookupErrors: 1,
      lastLookupLatencyMs: 5200,
    });
    expect(JSON.stringify(outcome)).not.toMatch(/abc\.example|stremio|tok2/);
  });

  it('warns when the last real stream lookup failed', async () => {
    const outcome = await checkGateway({
      config,
      stats: { ...stats, lastError: 'Could not get streams from the gateway (HTTP 429).' },
      fetch: async () => json({ name: 'AIOStreams', version: '1' }),
    });
    expect(outcome.status).toBe('warn');
    expect(outcome.hint).toBeTruthy();
  });

  it.each([
    [
      'connection refused',
      () => Promise.reject(new TypeError('fetch failed: getaddrinfo ENOTFOUND abc.example.test')),
      /unreachable/i,
    ],
    [
      'timeout',
      () => Promise.reject(Object.assign(new Error('timed out abc.example.test'), { name: 'TimeoutError' })),
      /slow or down/i,
    ],
  ])('is an error with a plain hint and no host when the request fails (%s)', async (_name, fail, hint) => {
    const outcome = await checkGateway({ config, stats, fetch: fail });
    expect(outcome.status).toBe('error');
    expect(outcome.hint).toMatch(hint);
    expect(JSON.stringify(outcome)).not.toMatch(/abc|example|stremio|tok2/);
  });

  it.each([
    [404, /refused the manifest/],
    [500, /problem on its side/],
  ])('maps HTTP %i to an error with the right hint', async (status, hint) => {
    const outcome = await checkGateway({ config, stats, fetch: async () => json({}, status) });
    expect(outcome.status).toBe('error');
    expect(outcome.hint).toMatch(hint);
  });

  it('is an error when the URL answers with something that is not an addon manifest', async () => {
    const outcome = await checkGateway({ config, stats, fetch: async () => json({ hello: 'world' }) });
    expect(outcome).toMatchObject({ status: 'error', message: expect.stringContaining('not with an addon manifest') });
  });

  it('is an error naming the missing key when no gateway is configured', async () => {
    const outcome = await checkGateway({
      config: { gatewayManifestUrl: null, configFile: CONFIG_FILE },
      stats,
      fetch: async () => json({}),
    });
    expect(outcome.status).toBe('error');
    expect(outcome.hint).toContain('GATEWAY_MANIFEST_URL');
    expect(outcome.hint).toContain(CONFIG_FILE.path);
  });
});

describe('checkTorbox', () => {
  const config = { torboxApiKey: 'torbox-secret-key-123456', configFile: CONFIG_FILE };
  const account = (extra: Record<string, unknown> = {}) => ({
    success: true,
    data: {
      id: 99,
      email: 'someone@example.com',
      user_referral: 'REFCODE',
      plan: 1,
      is_subscribed: true,
      premium_expires_at: new Date(NOW + 39 * DAY + 3600_000).toISOString(),
      ...extra,
    },
  });

  it('reports plan, subscription, expiry and days left, and copies no personal field', async () => {
    const outcome = await checkTorbox({ config, nowMs: NOW, fetch: async () => json(account()) });
    expect(outcome.status).toBe('ok');
    expect(outcome.details).toMatchObject({ plan: 'Essential', is_subscribed: true, daysLeft: 39 });
    const text = JSON.stringify(outcome);
    for (const personal of ['@', 'someone', 'REFCODE', '99,', 'torbox-secret']) expect(text).not.toContain(personal);
  });

  it('sends the key only as a Bearer header to the user endpoint', async () => {
    const seen: { url: string; auth: string | undefined }[] = [];
    await checkTorbox({
      config,
      nowMs: NOW,
      fetch: async (url, init) => {
        seen.push({ url, auth: init.headers.Authorization });
        return json(account());
      },
    });
    expect(seen).toEqual([{ url: 'https://api.torbox.app/v1/api/user/me', auth: 'Bearer torbox-secret-key-123456' }]);
  });

  it.each([
    [6, 'warn'],
    [7, 'ok'],
    [0, 'warn'],
  ] as const)('with %i full days left the status is %s', async (days, status) => {
    const outcome = await checkTorbox({
      config,
      nowMs: NOW,
      fetch: async () => json(account({ premium_expires_at: new Date(NOW + days * DAY + 3600_000).toISOString() })),
    });
    expect(outcome.status).toBe(status);
    if (status === 'warn') expect(outcome.hint).toMatch(/renew/i);
  });

  it('is an error with a renew hint when the subscription ended or is not active', async () => {
    const expired = await checkTorbox({
      config,
      nowMs: NOW,
      fetch: async () => json(account({ premium_expires_at: new Date(NOW - DAY).toISOString() })),
    });
    const inactive = await checkTorbox({
      config,
      nowMs: NOW,
      fetch: async () => json(account({ is_subscribed: false })),
    });
    for (const outcome of [expired, inactive]) {
      expect(outcome.status).toBe('error');
      expect(outcome.hint).toMatch(/renew it at torbox\.app/i);
    }
  });

  it.each([401, 403])('HTTP %i means a bad key: hint to re-check it at torbox.app, key not echoed', async (status) => {
    const outcome = await checkTorbox({ config, nowMs: NOW, fetch: async () => json({}, status) });
    expect(outcome.status).toBe('error');
    expect(outcome.hint).toContain('torbox.app');
    expect(outcome.hint).toContain('TORBOX_API_KEY');
    expect(JSON.stringify(outcome)).not.toContain('torbox-secret');
  });

  it('is an error when TorBox cannot be reached, and a warning (not an error) when no key is set', async () => {
    const down = await checkTorbox({ config, nowMs: NOW, fetch: () => Promise.reject(new TypeError('fetch failed')) });
    expect(down.status).toBe('error');
    expect(down.hint).toMatch(/internet/i);
    const none = await checkTorbox({
      config: { torboxApiKey: null, configFile: CONFIG_FILE },
      nowMs: NOW,
      fetch: async () => json({}),
    });
    expect(none).toMatchObject({ status: 'warn', hint: expect.stringContaining('TORBOX_API_KEY') });
  });
});

describe('checkTmdb', () => {
  const config = { tmdbReadToken: 'tmdb-test-token-123456', configFile: CONFIG_FILE };

  it('is ok when /configuration answers', async () => {
    expect((await checkTmdb({ config, ping: async () => undefined })).status).toBe('ok');
  });

  it('maps a rejected token to a hint that names TMDB_READ_TOKEN and the file, without the token', async () => {
    const outcome = await checkTmdb({
      config,
      ping: () => Promise.reject(new AppError(502, 'tmdb_auth_failed', 'rejected tmdb-test-token-123456')),
    });
    expect(outcome.status).toBe('error');
    expect(outcome.hint).toContain('TMDB_READ_TOKEN');
    expect(outcome.hint).toContain(CONFIG_FILE.path);
    expect(JSON.stringify(outcome)).not.toContain('tmdb-test-token');
  });

  it('maps any other failure to unreachable with an internet hint', async () => {
    const outcome = await checkTmdb({ config, ping: () => Promise.reject(new AppError(502, 'tmdb_unavailable', 'x')) });
    expect(outcome).toMatchObject({ status: 'error', hint: expect.stringMatching(/internet/i) });
  });

  it('is an error naming the missing key without calling TMDB', async () => {
    let calls = 0;
    const outcome = await checkTmdb({
      config: { tmdbReadToken: null, configFile: CONFIG_FILE },
      ping: async () => {
        calls += 1;
      },
    });
    expect(outcome.status).toBe('error');
    expect(outcome.hint).toContain('TMDB_READ_TOKEN');
    expect(calls).toBe(0);
  });
});

describe('ffmpeg parsing', () => {
  it('reads the version number from the banner', () => {
    expect(parseVersion('ffmpeg version 9.0.2-full_build-www.gyan.dev Copyright (c) 2000-2026\nbuilt with')).toBe(
      '9.0.2',
    );
    expect(parseVersion('ffprobe version n8.1 Copyright')).toBe('8.1');
    expect(parseVersion('')).toBeNull();
  });

  it('finds video encoders by exact name', () => {
    const list =
      ' V....D h264_nvenc           NVIDIA NVENC H.264 encoder\n V....D hevc_nvenc_x         other\n A....D aac AAC\n';
    expect(parseEncoders(list, ['h264_nvenc', 'hevc_nvenc'])).toEqual({ h264_nvenc: true, hevc_nvenc: false });
  });
});

describe('checkFfmpeg', () => {
  const config = { ffmpegPath: 'ffmpeg', ffprobePath: 'ffprobe', configFile: CONFIG_FILE, healthNvencTest: true };
  const ok = (stdout = ''): CommandResult => ({ code: 0, stdout, stderr: '' });
  const ENCODERS = ' V....D h264_nvenc NVENC\n V....D hevc_nvenc NVENC\n';

  function runner(
    overrides: { encode?: CommandResult; encoders?: string; ffmpeg?: CommandResult; ffprobe?: CommandResult } = {},
  ) {
    const calls: string[][] = [];
    const run: CommandRunner = async (file, args) => {
      calls.push([file, ...args]);
      if (args.includes('-version')) {
        return (file === 'ffprobe' ? overrides.ffprobe : overrides.ffmpeg) ?? ok(`${file} version 9.0.2-full\n`);
      }
      if (args.includes('-encoders')) return ok(overrides.encoders ?? ENCODERS);
      return overrides.encode ?? ok();
    };
    return { run, calls };
  }

  it('reports versions, both NVENC encoders and a timed 1 s test encode to the null muxer', async () => {
    const { run, calls } = runner();
    let clock = 1000;
    const outcome = await checkFfmpeg({ config, run, now: () => (clock += 120) });
    expect(outcome.status).toBe('ok');
    expect(outcome.details).toMatchObject({
      ffmpegVersion: '9.0.2',
      ffprobeVersion: '9.0.2',
      h264_nvenc: true,
      hevc_nvenc: true,
      testEncode: { ok: true, durationMs: 120 },
    });
    const encode = calls.find((call) => call.includes('h264_nvenc')) as string[];
    expect(encode.join(' ')).toContain('testsrc=duration=1');
    expect(encode.slice(-3)).toEqual(['-f', 'null', '-']);
  });

  it('skips the encode when HEALTH_NVENC_TEST is off and says so', async () => {
    const { run, calls } = runner();
    const outcome = await checkFfmpeg({ config: { ...config, healthNvencTest: false }, run });
    expect(outcome.status).toBe('ok');
    expect(outcome.details.testEncode).toEqual({ ok: null, skipped: true });
    expect(calls.some((call) => call.includes('h264_nvenc') && call.includes('-i'))).toBe(false);
  });

  it('is an error with an FFMPEG_PATH hint when ffmpeg is missing, and runs nothing else', async () => {
    const { run, calls } = runner({ ffmpeg: { code: null, stdout: '', stderr: '', failure: 'ENOENT' } });
    const outcome = await checkFfmpeg({ config: { ...config, ffmpegPath: 'ffmpeg' }, run });
    expect(outcome.status).toBe('error');
    expect(outcome.message).toMatch(/not found/);
    expect(outcome.hint).toContain('FFMPEG_PATH');
    expect(outcome.hint).toContain(CONFIG_FILE.path);
    expect(calls).toHaveLength(1);
  });

  it('is an error naming FFPROBE_PATH when only ffprobe is missing', async () => {
    const { run } = runner({ ffprobe: { code: null, stdout: '', stderr: '', failure: 'ENOENT' } });
    const outcome = await checkFfmpeg({ config, run });
    expect(outcome).toMatchObject({ status: 'error', hint: expect.stringContaining('FFPROBE_PATH') });
  });

  it('is an error when the build lacks an NVENC encoder', async () => {
    const { run } = runner({ encoders: ' V....D h264_nvenc NVENC\n' });
    const outcome = await checkFfmpeg({ config, run });
    expect(outcome.status).toBe('error');
    expect(outcome.message).toContain('hevc_nvenc');
    expect(outcome.hint).toMatch(/NVENC/);
  });

  it('is an error with driver/GPU/path advice when the test encode fails, keeping the last stderr line', async () => {
    const { run } = runner({
      encode: { code: 1, stdout: '', stderr: 'noise\nOpenEncodeSessionEx failed: out of memory (10)\n' },
    });
    const outcome = await checkFfmpeg({ config, run });
    expect(outcome.status).toBe('error');
    expect(outcome.hint).toMatch(/driver/i);
    expect(outcome.hint).toContain('FFMPEG_PATH');
    expect(outcome.details.testEncode).toMatchObject({
      ok: false,
      error: 'OpenEncodeSessionEx failed: out of memory (10)',
    });
  });
});

describe('GPU check', () => {
  const LINE = 'NVIDIA GeForce RTX 4080, 581.29, 12, 0, 2310, 16376, 48\n';
  const runner =
    (stdout: string, extra: Partial<CommandResult> = {}): CommandRunner =>
    async () => ({ code: 0, stdout, stderr: '', ...extra });

  it('parses the nvidia-smi CSV, turning [N/A] into null', () => {
    expect(parseGpuCsv(LINE)).toEqual({
      name: 'NVIDIA GeForce RTX 4080',
      driverVersion: '581.29',
      gpuUtilizationPct: 12,
      encoderUtilizationPct: 0,
      memoryUsedMb: 2310,
      memoryTotalMb: 16376,
      temperatureC: 48,
    });
    expect(parseGpuCsv('GPU, 1.0, [N/A], 0, 1, 2, 3')?.gpuUtilizationPct).toBeNull();
    expect(parseGpuCsv('')).toBeNull();
    expect(parseGpuCsv('garbage')).toBeNull();
  });

  it('is ok with the metrics in the details', async () => {
    const outcome = await checkGpu({ run: runner(LINE) });
    expect(outcome.status).toBe('ok');
    expect(outcome.details).toMatchObject({
      name: 'NVIDIA GeForce RTX 4080',
      temperatureC: 48,
      memoryTotalMb: 16376,
      encoderUtilizationPct: 0,
    });
  });

  it.each([
    [85, 'ok'],
    [86, 'warn'],
  ] as const)('at %i C the status is %s', async (temp, status) => {
    const outcome = await checkGpu({ run: runner(`NVIDIA GeForce RTX 4080, 581.29, 99, 40, 9000, 16376, ${temp}\n`) });
    expect(outcome.status).toBe(status);
    if (status === 'warn') expect(outcome.hint).toMatch(/airflow|fans/);
  });

  it('is an error with a driver hint when nvidia-smi is missing or fails', async () => {
    const missing = await checkGpu({ run: runner('', { code: null, failure: 'ENOENT' }) });
    const failed = await checkGpu({ run: runner('', { code: 9 }) });
    for (const outcome of [missing, failed]) {
      expect(outcome.status).toBe('error');
      expect(outcome.hint).toMatch(/driver/i);
    }
  });
});

describe('checkSessions', () => {
  const event = {
    id: 1,
    ts: NOW,
    level: 'error' as const,
    source: 'ffmpeg' as const,
    message: 'Encoder stopped',
    sessionId: 's1',
  };

  it('is ok with the active count when nothing is wrong', () => {
    const outcome = checkSessions({
      active: () => 2,
      fallingBehind: () => [],
      recentErrors: () => ({ count: 0, latest: [] }),
    });
    expect(outcome).toMatchObject({
      status: 'ok',
      message: '2 active sessions',
      details: { active: 2, errorsLast15Min: 0, fallingBehind: [] },
    });
  });

  it('warns about recent errors and lists them', () => {
    const outcome = checkSessions({
      active: () => 0,
      fallingBehind: () => [],
      recentErrors: () => ({ count: 1, latest: [event] }),
    });
    expect(outcome.status).toBe('warn');
    expect(outcome.hint).toBeTruthy();
    expect(outcome.details.recentErrors).toEqual([
      { ts: NOW, source: 'ffmpeg', message: 'Encoder stopped', sessionId: 's1' },
    ]);
  });

  it('warns only for sessions the manager reports as falling behind', () => {
    const behind = checkSessions({
      active: () => 1,
      fallingBehind: () => ['s1'],
      recentErrors: () => ({ count: 0, latest: [] }),
    });
    expect(behind).toMatchObject({ status: 'warn', details: { fallingBehind: ['s1'] } });
    const waiting = checkSessions({
      active: () => 1,
      fallingBehind: () => [],
      recentErrors: () => ({ count: 0, latest: [] }),
    });
    expect(waiting.status).toBe('ok');
  });
});
