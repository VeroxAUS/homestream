import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  DEFAULT_DATA_DIR,
  dataDirFrom,
  loadShellEnv,
  portFrom,
  prepareConfigFile,
  resolveEnvFile,
} from '../src/envFile.js';
import { loadingPageUrl, loadingViewFor, nextPage } from '../src/loadingPage.js';
import { failureCodeFrom, failureHint, resolveServerLaunch } from '../src/serverLaunch.js';

const temp = mkdtempSync(path.join(os.tmpdir(), 'hs-desktop-'));
afterAll(() => rmSync(temp, { recursive: true, force: true }));

describe('resolveServerLaunch', () => {
  const base = {
    appPath: path.join('C:', 'repo', 'apps', 'desktop'),
    resourcesPath: path.join('C:', 'Apps', 'HomeStream', 'resources'),
    execPath: 'C:\\Apps\\HomeStream\\HomeStream.exe',
  };

  it('runs system node on the built server in development', () => {
    const launch = resolveServerLaunch({ ...base, packaged: false, env: { ELECTRON_RUN_AS_NODE: '1', KEEP: 'y' } });
    expect(launch.command).toBe('node');
    expect(launch.args).toEqual([path.resolve(base.appPath, '..', 'server', 'dist', 'index.js')]);
    expect(launch.env.ELECTRON_RUN_AS_NODE).toBeUndefined();
    expect(launch.env.KEEP).toBe('y');
  });

  it('runs its own executable as plain Node on the bundled server when packaged', () => {
    const launch = resolveServerLaunch({ ...base, packaged: true, env: {} });
    expect(launch.command).toBe(base.execPath);
    expect(launch.args).toEqual([path.join(base.resourcesPath, 'server', 'dist', 'index.js')]);
    expect(launch.env).toMatchObject({
      ELECTRON_RUN_AS_NODE: '1',
      HOMESTREAM_PACKAGED: '1',
      HOMESTREAM_WEB_DIR: path.join(base.resourcesPath, 'web'),
    });
  });

  it('lets HOMESTREAM_WEB_DIR win', () => {
    const launch = resolveServerLaunch({ ...base, packaged: true, env: { HOMESTREAM_WEB_DIR: 'X:\\web' } });
    expect(launch.env.HOMESTREAM_WEB_DIR).toBe('X:\\web');
  });
});

describe('failure explanations', () => {
  it('names the cause from the server output', () => {
    expect(failureCodeFrom(['Error: listen EADDRINUSE :::8600'], 1)).toBe('EADDRINUSE');
    expect(failureCodeFrom(['listen EACCES'], 1)).toBe('EACCES');
    expect(failureCodeFrom(["Cannot find module 'x'"], 1)).toBe('SERVER_NOT_BUILT');
    expect(failureCodeFrom(['spawn node ENOENT'], null)).toBe('ENOENT');
    expect(failureCodeFrom([], 3)).toBe('EXIT_3');
    expect(failureCodeFrom([], null)).toBe('KILLED');
  });

  it('turns it into a plain hint', () => {
    expect(failureHint('EADDRINUSE', 8600)).toBe(
      'another program is already using port 8600. Close that program, or set a different PORT in config.env, then press Retry.',
    );
    expect(failureHint('EACCES', 8600)).toContain('port 8600');
    expect(failureHint('SERVER_NOT_BUILT', 8600)).toContain('missing');
    expect(failureHint('EXIT_1', 8600)).toContain('Open the logs');
  });
});

describe('env file', () => {
  const location = { env: {}, appData: 'C:\\Users\\x\\AppData\\Roaming', repoRoot: 'C:\\repo' };

  it('lets HOMESTREAM_ENV_FILE win', () => {
    expect(resolveEnvFile({ ...location, packaged: true, env: { HOMESTREAM_ENV_FILE: 'D:\\my.env' } })).toBe(
      'D:\\my.env',
    );
  });

  it('uses the AppData config when packaged and the repo .env in development', () => {
    expect(resolveEnvFile({ ...location, packaged: true, repoRoot: null })).toBe(
      path.join(location.appData, 'HomeStream', 'config.env'),
    );
    expect(resolveEnvFile({ ...location, packaged: false, exists: () => false })).toBe(path.join('C:\\repo', '.env'));
    const appData = path.join(location.appData, 'HomeStream', 'config.env');
    expect(resolveEnvFile({ ...location, packaged: false, exists: (file) => file === appData })).toBe(appData);
  });

  it('copies only the shell keys and never overrides the environment', () => {
    const env: NodeJS.ProcessEnv = { PORT: '8700' };
    const loaded = loadShellEnv(
      'x.env',
      env,
      () => 'PORT=8600\nDATA_DIR=D:\\data\nTMDB_READ_TOKEN=secret\nSENTRY_DSN_WEB=https://k@o.test/1\n',
    );
    expect(loaded.sort()).toEqual(['DATA_DIR', 'SENTRY_DSN_WEB']);
    expect(env.PORT).toBe('8700');
    expect(env.TMDB_READ_TOKEN).toBeUndefined();
    expect(loadShellEnv('missing.env', {}, () => null)).toEqual([]);
  });

  it('reads the data dir and port with defaults', () => {
    expect(dataDirFrom({})).toBe(DEFAULT_DATA_DIR);
    expect(dataDirFrom({ DATA_DIR: ' D:\\d ' })).toBe('D:\\d');
    expect(portFrom({})).toBe(8600);
    expect(portFrom({ PORT: '8610' })).toBe(8610);
    expect(portFrom({ PORT: 'abc' })).toBe(8600);
    expect(portFrom({ PORT: '70000' })).toBe(8600);
  });

  it('creates a missing config file with key names only, and opens only .env files', () => {
    const file = path.join(temp, 'sub', 'config.env');
    expect(prepareConfigFile(file)).toBe(true);
    const text = readFileSync(file, 'utf8');
    expect(text).toContain('TMDB_READ_TOKEN=');
    expect(text).toMatch(/GATEWAY_MANIFEST_URL=\r?\n/);
    writeFileSync(file, 'TMDB_READ_TOKEN=keep\n');
    expect(prepareConfigFile(file)).toBe(true);
    expect(readFileSync(file, 'utf8')).toBe('TMDB_READ_TOKEN=keep\n');
    expect(prepareConfigFile(path.join(temp, 'notes.txt'))).toBe(false);
    expect(prepareConfigFile('C:\\Windows\\system32\\cmd.exe')).toBe(false);
  });
});

describe('startup page', () => {
  const page = 'file:///app/dist/assets/loading.html';

  it('builds the Starting URL from fixed words only', () => {
    const url = new URL(loadingPageUrl(page, loadingViewFor({ kind: 'starting' }, '1.2.3', 8600)));
    expect(url.searchParams.get('state')).toBe('starting');
    expect(url.searchParams.get('v')).toBe('1.2.3');
    expect(url.searchParams.get('port')).toBe('8600');
    expect(url.searchParams.has('hint')).toBe(false);
  });

  it('builds the Failed URL with the code, hint and time of the last attempt', () => {
    const view = loadingViewFor(
      { kind: 'failed', code: 'EADDRINUSE', lastAttemptAt: 1_700_000_000_000 },
      '1.2.3',
      8600,
    );
    const url = new URL(loadingPageUrl(page, view));
    expect(url.searchParams.get('state')).toBe('failed');
    expect(url.searchParams.get('code')).toBe('EADDRINUSE');
    expect(url.searchParams.get('hint')).toContain('port 8600');
    expect(url.searchParams.get('at')).toBe('1700000000000');
  });

  it('decides the page from the server state', () => {
    const failed = { kind: 'failed', code: 'x', lastAttemptAt: 1 } as const;
    expect(nextPage('none', { kind: 'starting' })).toBe('starting');
    expect(nextPage('starting', { kind: 'running', pid: 1 })).toBe('app');
    expect(nextPage('starting', { kind: 'attached' })).toBe('app');
    expect(nextPage('app', { kind: 'crashed', attempt: 1, retryAt: 1 })).toBe('app');
    expect(nextPage('app', failed)).toBe('failed');
    expect(nextPage('failed', { kind: 'starting' })).toBe('starting');
    expect(nextPage('starting', { kind: 'crashed', attempt: 1, retryAt: 1 })).toBe('starting');
    expect(nextPage('failed', { kind: 'running', pid: 1 })).toBe('app');
  });
});
