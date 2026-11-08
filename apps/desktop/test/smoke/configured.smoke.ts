import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { evaluate } from './cdp.js';
import {
  HOME_PROBE,
  isHomeRendered,
  quitShell,
  repoRoot,
  startShell,
  stopShell,
  until,
  type HomeSnapshot,
  type Shell,
} from './harness.js';

// The configured launch: the same shell as launch.smoke.ts, but with an env file that holds both required keys, so
// Home renders its rows instead of the first-run screen. TMDB and the gateway are the e2e stub hub of the web app and
// the keys are invented: nothing leaves the machine and no playback session starts.
const SERVER_PORT = 8618;
const DEBUG_PORT = 8619;
const webE2e = path.join(repoRoot, 'apps', 'web', 'e2e');
// Read at run time: the two apps never import each other, but they agree on the hub's ports.
const hubPorts = JSON.parse(readFileSync(path.join(webE2e, 'ports.json'), 'utf8')) as {
  tmdb: number;
  gateway: number;
  sentry: number;
};
const FAKE_TMDB_TOKEN = 'smoke-not-a-real-token';
const FAKE_GATEWAY_URL = `http://127.0.0.1:${hubPorts.gateway}/stub/manifest.json`;

async function hubUp(): Promise<boolean> {
  try {
    return (await fetch(`http://127.0.0.1:${hubPorts.sentry}/__health`, { signal: AbortSignal.timeout(2000) })).ok;
  } catch {
    return false;
  }
}

describe('Electron launch smoke test: configured', () => {
  let hub: ChildProcess | null = null;
  let shell: Shell | undefined;

  beforeAll(async () => {
    if (await hubUp()) throw new Error(`Something already answers on the e2e stub hub port ${hubPorts.sentry}.`);
    hub = spawn(process.execPath, [path.join(webE2e, 'support', 'hub.mjs')], { stdio: 'ignore', windowsHide: true });
    await until('the stub hub', 30_000, hubUp);
    shell = await startShell({
      prefix: 'hs-smoke-configured-',
      serverPort: SERVER_PORT,
      debugPort: DEBUG_PORT,
      env: (root) => {
        const envFile = path.join(root, 'keys.env');
        writeFileSync(envFile, `TMDB_READ_TOKEN=${FAKE_TMDB_TOKEN}\nGATEWAY_MANIFEST_URL=${FAKE_GATEWAY_URL}\n`);
        return {
          HOMESTREAM_ENV_FILE: envFile,
          // A key already in the environment would win over the file; pin them so no real one can get in.
          TMDB_READ_TOKEN: FAKE_TMDB_TOKEN,
          GATEWAY_MANIFEST_URL: FAKE_GATEWAY_URL,
          TORBOX_API_KEY: '',
          E2E_TMDB_ORIGIN: `http://127.0.0.1:${hubPorts.tmdb}`,
          // Points the server's TMDB calls at the stub and refuses any other request that would leave the machine.
          NODE_OPTIONS: `--import ${pathToFileURL(path.join(webE2e, 'support', 'redirect-fetch.mjs')).href}`,
          MAX_DOWNLOAD_MBPS: '60',
        };
      },
    });
  }, 180_000);

  afterAll(() => {
    if (shell) stopShell(shell);
    if (hub?.pid && hub.exitCode === null) hub.kill();
  });

  it('renders Home with poster rows, not the first-run screen', async () => {
    let last = undefined as HomeSnapshot | undefined;
    await until('Home to show its rows', 60_000, async () => {
      last = (await evaluate(shell!.page, HOME_PROBE)) as HomeSnapshot;
      return isHomeRendered(last);
    }).catch((error: unknown) => {
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}; the window showed ${JSON.stringify(last)}`,
      );
    });
    expect(last!.setupScreen).toBe(false);
    expect(last!.posterTitles.join(' ')).toContain('The Stub Matrix');
    expect(await evaluate(shell!.page, 'window.homestream.isDesktop')).toBe(true);
  });

  it('got those rows from the stub TMDB and started no playback session', async () => {
    const log = (await (await fetch(`http://127.0.0.1:${hubPorts.tmdb}/__requests`)).json()) as {
      requests: Array<{ upstream: string; path: string }>;
    };
    expect(log.requests.some((entry) => entry.upstream === 'tmdb' && entry.path.startsWith('/trending/movie'))).toBe(
      true,
    );
    const activity = (await (await fetch(`http://127.0.0.1:${SERVER_PORT}/api/activity`)).json()) as {
      sessions: unknown[];
    };
    expect(activity.sessions).toEqual([]);
  });

  it('a second launch with --quit ends the app, the server and every child it started', async () => {
    const status = String(await evaluate(shell!.page, 'window.homestream.getServerStatus()'));
    const serverPid = /pid (\d+)/.exec(status)?.[1];
    expect(serverPid, status).toBeDefined();
    const result = await quitShell(shell!, [Number(serverPid)]);
    expect(result).toEqual({ launcherStatus: 0, exitCode: 0, serverStillUp: false, leftovers: [] });
  }, 120_000);
});
