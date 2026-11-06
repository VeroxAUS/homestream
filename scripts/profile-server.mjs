import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isMain, repoRoot } from './lib/util.mjs';

/**
 * Starts the server with `node --cpu-prof`, sends light traffic for a few seconds, stops it cleanly and leaves the
 * CPU profile in reports/profiles. Open the .cpuprofile in Chrome DevTools (Performance, Load profile) or VS Code.
 * Telemetry and the NVENC health test are off, and the server uses a throw-away data directory. `pnpm profile:server`.
 */

const DEFAULT_PORT = 8602;
const DEFAULT_SECONDS = 8;
const STARTUP_TIMEOUT_MS = 30_000;
const STOP_TIMEOUT_MS = 10_000;

export function parseArgs(argv) {
  let port = DEFAULT_PORT;
  let seconds = DEFAULT_SECONDS;
  for (const arg of argv) {
    const match = /^--(port|seconds)=(\d+)$/.exec(arg);
    if (!match) return null;
    if (match[1] === 'port') port = Number(match[2]);
    else seconds = Number(match[2]);
  }
  // Ports 8600-8699 belong to HomeStream; the source proxy takes port + 50.
  if (port < 8600 || port > 8649 || seconds < 1 || seconds > 120) return null;
  return { port, seconds };
}

export function serverEnv(port, dataDir, base = process.env) {
  return {
    ...base,
    PORT: String(port),
    SOURCE_PROXY_PORT: String(port + 50),
    DATA_DIR: dataDir,
    TRANSCODE_DIR: path.join(dataDir, 'transcode'),
    HOMESTREAM_TELEMETRY: 'off',
    HEALTH_NVENC_TEST: 'off',
    LOG_LEVEL: 'warn',
  };
}

async function waitUntilReady(base, child) {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`The server exited early with code ${child.exitCode}.`);
    try {
      const response = await fetch(`${base}/healthz`, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return;
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('The server did not become ready in time.');
}

async function sendTraffic(base, seconds) {
  const stopAt = Date.now() + seconds * 1000;
  // Local endpoints only: nothing here calls TMDB, the gateway or the GPU.
  const paths = ['/api/info', '/api/health', '/healthz', '/readyz', '/metrics'];
  let sent = 0;
  const worker = async () => {
    while (Date.now() < stopAt) {
      const target = paths[sent % paths.length];
      sent += 1;
      await fetch(`${base}${target}`, { signal: AbortSignal.timeout(5000) }).then(
        (response) => response.arrayBuffer(),
        () => undefined,
      );
    }
  };
  await Promise.all([worker(), worker()]);
  return sent;
}

async function stopServer(child) {
  const exited = new Promise((resolve) => child.once('exit', resolve));
  child.stdin.write('shutdown\n');
  const timer = setTimeout(() => child.kill(), STOP_TIMEOUT_MS);
  await exited;
  clearTimeout(timer);
}

export async function main(argv, root = repoRoot()) {
  const args = parseArgs(argv);
  if (!args) {
    console.error('Usage: node scripts/profile-server.mjs [--port=8600..8649] [--seconds=1..120]');
    return 2;
  }
  const profileDir = path.join(root, 'reports', 'profiles');
  mkdirSync(profileDir, { recursive: true });
  const profileName = `server-${new Date().toISOString().replace(/[:.]/g, '-')}.cpuprofile`;
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'homestream-profile-'));
  const serverDir = path.join(root, 'apps', 'server');
  const child = spawn(
    process.execPath,
    ['--cpu-prof', `--cpu-prof-dir=${profileDir}`, `--cpu-prof-name=${profileName}`, '--import', 'tsx', 'src/index.ts'],
    { cwd: serverDir, env: serverEnv(args.port, dataDir), stdio: ['pipe', 'ignore', 'inherit'], windowsHide: true },
  );
  try {
    const base = `http://127.0.0.1:${args.port}`;
    await waitUntilReady(base, child);
    const sent = await sendTraffic(base, args.seconds);
    console.log(`[profile] sent ${sent} requests over ${args.seconds} s`);
  } catch (error) {
    console.error(`[profile] ${error instanceof Error ? error.message : 'failed'}`);
    return 1;
  } finally {
    if (child.exitCode === null) await stopServer(child);
    rmSync(dataDir, { recursive: true, force: true });
  }
  if (!readdirSync(profileDir).includes(profileName)) {
    console.error('[profile] the server stopped but wrote no profile');
    return 1;
  }
  console.log(`[profile] wrote ${path.join('reports', 'profiles', profileName)}`);
  return 0;
}

if (isMain(import.meta.url)) process.exit(await main(process.argv.slice(2)));
