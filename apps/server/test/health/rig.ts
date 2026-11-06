import type { HealthResponse } from '@homestream/shared';
import type { FastifyInstance } from 'fastify';
import { buildApp, type BuildAppOptions } from '../../src/app.js';
import { openDatabase } from '../../src/db/index.js';
import type { HealthFetch } from '../../src/health/checks/gateway.js';
import type { CommandResult, CommandRunner } from '../../src/health/exec.js';
import { createSilentLogger } from '../../src/logger.js';
import { TmdbService } from '../../src/tmdb/service.js';
import { testConfig } from '../helpers.js';
import { makeFakeTmdb, type FakeTmdb } from '../tmdb/fixtures.js';

const GIB = 1024 ** 3;
export const GPU_LINE = 'NVIDIA GeForce RTX 4080, 581.29, 3, 0, 2310, 16376, 48\n';
const ENCODERS = ' V....D h264_nvenc NVENC\n V....D hevc_nvenc NVENC\n';

export interface HealthRig {
  app: FastifyInstance;
  /** Closes the app and the database it was given. */
  close(): Promise<void>;
  tmdb: FakeTmdb;
  /** Requests the health service made: gateway manifest and TorBox. */
  fetched: string[];
  /** Child processes the health service started, as `file arg arg`. */
  commands: string[];
  clock: { now: number; advance(ms: number): void };
  torbox: { status: number; body: unknown };
  gateway: { respond: (url: string) => Response | Promise<Response> };
  runResults: { gpu: CommandResult; ffmpegVersion: CommandResult; encode: CommandResult };
  freeGb: { transcode: number; data: number };
  health(): Promise<HealthResponse>;
  run(query?: string): Promise<HealthResponse>;
  check(body: HealthResponse, id: string): HealthResponse['checks'][number];
}

export const torboxAccount = (days = 39, nowMs = Date.now()): unknown => ({
  success: true,
  data: {
    id: 4242,
    email: 'someone@example.com',
    user_referral: 'REFCODE1',
    plan: 1,
    is_subscribed: true,
    premium_expires_at: new Date(nowMs + days * 24 * 3600 * 1000 + 3600_000).toISOString(),
  },
});

export async function bootHealthRig(
  root: string,
  options: { env?: Record<string, string>; envFile?: string; app?: BuildAppOptions } = {},
): Promise<HealthRig> {
  const config = testConfig(root, { HEALTH_NVENC_TEST: '1', ...options.env }, options.envFile);
  const fakeTmdb = makeFakeTmdb();
  const clock = {
    now: Date.now(),
    advance(ms: number) {
      this.now += ms;
    },
  };
  const logger = createSilentLogger();
  const db = openDatabase(config.dataDir);
  const tmdb = new TmdbService({ config, db, logger, fetch: fakeTmdb.fetch });
  const fetched: string[] = [];
  const commands: string[] = [];
  const rig = {
    tmdb: fakeTmdb,
    fetched,
    commands,
    clock,
    torbox: { status: 200, body: torboxAccount(39, clock.now) },
    gateway: { respond: (): Response => new Response(JSON.stringify({ name: 'AIOStreams', version: '2.20.1' })) },
    runResults: {
      gpu: { code: 0, stdout: GPU_LINE, stderr: '' } as CommandResult,
      ffmpegVersion: { code: 0, stdout: 'ffmpeg version 9.0.2-full_build\n', stderr: '' } as CommandResult,
      encode: { code: 0, stdout: '', stderr: '' } as CommandResult,
    },
    freeGb: { transcode: 500, data: 500 },
  } as unknown as HealthRig;

  const fetchImpl: HealthFetch = async (url) => {
    fetched.push(url);
    if (url.startsWith('https://api.torbox.app/'))
      return new Response(JSON.stringify(rig.torbox.body), { status: rig.torbox.status });
    return rig.gateway.respond(url);
  };
  const run: CommandRunner = async (file, args) => {
    commands.push([file, ...args].join(' '));
    if (file === 'nvidia-smi') return rig.runResults.gpu;
    if (args.includes('-version'))
      return file.includes('ffprobe')
        ? { code: 0, stdout: 'ffprobe version 9.0.2-full_build\n', stderr: '' }
        : rig.runResults.ffmpegVersion;
    if (args.includes('-encoders')) return { code: 0, stdout: ENCODERS, stderr: '' };
    return rig.runResults.encode;
  };

  rig.app = await buildApp(config, {
    logger,
    db,
    tmdb,
    health: {
      fetch: fetchImpl,
      run,
      now: () => clock.now,
      diskProbe: async (dir) => ({
        freeBytes: (dir === config.transcodeDir ? rig.freeGb.transcode : rig.freeGb.data) * GIB,
        totalBytes: 1000 * GIB,
      }),
    },
    ...options.app,
  });
  rig.close = async () => {
    await rig.app.close();
    db.close();
  };
  rig.health = async () => (await rig.app.inject('/api/health')).json();
  rig.run = async (query = '') => (await rig.app.inject({ method: 'POST', url: `/api/health/run${query}` })).json();
  rig.check = (body, id) => {
    const found = body.checks.find((check) => check.id === id);
    if (!found) throw new Error(`no ${id} check`);
    return found;
  };
  return rig;
}
