import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { clearSecrets, redact } from '../src/redact.js';
import { makeTempDir, removeDir } from './helpers.js';

let root: string;
beforeAll(() => {
  root = makeTempDir('config');
});
afterAll(() => removeDir(root));
afterEach(() => clearSecrets());

function envFile(name: string, content: string): string {
  const file = path.join(root, name);
  writeFileSync(file, content);
  return file;
}

describe('loadConfig', () => {
  it('uses documented defaults and reports missing required keys without throwing', () => {
    const file = envFile('empty.env', '# nothing\n');
    const config = loadConfig({ env: { HOMESTREAM_ENV_FILE: file }, repoRoot: null });
    expect(config.port).toBe(8600);
    expect(config.dataDir).toBe('E:\\HomeStream\\data');
    expect(config.transcodeDir).toBe('E:\\HomeStream\\transcode');
    expect(config.ffmpegThreads).toBe(4);
    expect(config.ffmpegBurnThreads).toBe(8);
    expect(config.transcodeMaxGb).toBe(20);
    expect(config.ffmpegPath).toBe('ffmpeg');
    expect(config.serverName).toMatch(/^HomeStream on /);
    expect(config.missingKeys).toEqual(['GATEWAY_MANIFEST_URL', 'TMDB_READ_TOKEN']);
    expect(config.configFile).toMatchObject({ path: file, exists: true, source: 'env' });
  });

  it('reads FFMPEG_THREADS and FFMPEG_BURN_THREADS and rejects values that are not positive whole numbers', () => {
    const set = loadConfig({
      env: { HOMESTREAM_ENV_FILE: envFile('threads.env', 'FFMPEG_THREADS=2\nFFMPEG_BURN_THREADS=6\n') },
      repoRoot: null,
    });
    expect([set.ffmpegThreads, set.ffmpegBurnThreads]).toEqual([2, 6]);

    const bad = loadConfig({
      env: { HOMESTREAM_ENV_FILE: envFile('badthreads.env', 'FFMPEG_THREADS=0\nFFMPEG_BURN_THREADS=2.5\n') },
      repoRoot: null,
    });
    expect([bad.ffmpegThreads, bad.ffmpegBurnThreads]).toEqual([4, 8]);
    expect(bad.warnings.join(' ')).toContain('FFMPEG_THREADS');
    expect(bad.warnings.join(' ')).toContain('FFMPEG_BURN_THREADS');
  });

  it('reads FFMPEG_MAX_RSS_MB with a 4096 MiB default and rejects values that are not positive whole numbers', () => {
    const none = loadConfig({
      env: { HOMESTREAM_ENV_FILE: envFile('rss-default.env', '# nothing\n') },
      repoRoot: null,
    });
    expect(none.ffmpegMaxRssMb).toBe(4096);
    const set = loadConfig({
      env: { HOMESTREAM_ENV_FILE: envFile('rss.env', 'FFMPEG_MAX_RSS_MB=2048\n') },
      repoRoot: null,
    });
    expect(set.ffmpegMaxRssMb).toBe(2048);
    const bad = loadConfig({
      env: { HOMESTREAM_ENV_FILE: envFile('rss-bad.env', 'FFMPEG_MAX_RSS_MB=-1\n') },
      repoRoot: null,
    });
    expect(bad.ffmpegMaxRssMb).toBe(4096);
    expect(bad.warnings.join(' ')).toContain('FFMPEG_MAX_RSS_MB');
  });

  it('reads the download limits from the file, lets process env override them, and defaults to 150 / 180 / 120', () => {
    const none = loadConfig({
      env: { HOMESTREAM_ENV_FILE: envFile('limits-default.env', '# nothing\n') },
      repoRoot: null,
    });
    expect([none.maxDownloadMbps, none.readAheadSec, none.readAheadResumeSec]).toEqual([150, 180, 120]);

    const file = envFile('limits.env', 'MAX_DOWNLOAD_MBPS=45\nREAD_AHEAD_SEC=240\nREAD_AHEAD_RESUME_SEC=150\n');
    const fromFile = loadConfig({ env: { HOMESTREAM_ENV_FILE: file }, repoRoot: null });
    expect([fromFile.maxDownloadMbps, fromFile.readAheadSec, fromFile.readAheadResumeSec]).toEqual([45, 240, 150]);
    expect(fromFile.warnings).toEqual([]);

    const overridden = loadConfig({ env: { HOMESTREAM_ENV_FILE: file, MAX_DOWNLOAD_MBPS: '50' }, repoRoot: null });
    expect([overridden.maxDownloadMbps, overridden.readAheadSec, overridden.readAheadResumeSec]).toEqual([
      50, 240, 150,
    ]);
  });

  it.each([
    ['MAX_DOWNLOAD_MBPS=abc', 'MAX_DOWNLOAD_MBPS', [150, 180, 120]],
    ['MAX_DOWNLOAD_MBPS=0', 'MAX_DOWNLOAD_MBPS', [150, 180, 120]],
    ['MAX_DOWNLOAD_MBPS=-10', 'MAX_DOWNLOAD_MBPS', [150, 180, 120]],
    ['MAX_DOWNLOAD_MBPS=2', 'MAX_DOWNLOAD_MBPS', [150, 180, 120]],
    ['READ_AHEAD_SEC=fast', 'READ_AHEAD_SEC', [150, 180, 120]],
    ['READ_AHEAD_SEC=0', 'READ_AHEAD_SEC', [150, 180, 120]],
    ['READ_AHEAD_RESUME_SEC=-1', 'READ_AHEAD_RESUME_SEC', [150, 180, 120]],
    ['READ_AHEAD_SEC=180\nREAD_AHEAD_RESUME_SEC=200', 'READ_AHEAD_RESUME_SEC', [150, 180, 120]],
  ])(
    'keeps the server up and falls back to the default with a warning naming the key for %j',
    (content, key, expected) => {
      const config = loadConfig({
        env: { HOMESTREAM_ENV_FILE: envFile('limits-bad.env', `${content}\n`) },
        repoRoot: null,
      });
      expect([config.maxDownloadMbps, config.readAheadSec, config.readAheadResumeSec]).toEqual(expected);
      expect(config.warnings).toHaveLength(1);
      expect(config.warnings[0]).toContain(key);
      expect(config.warnings[0]).toContain('invalid');
      expect(config.warnings[0]).toMatch(/default/);
    },
  );

  it('reads LOG_LEVEL (info by default) and falls back with a warning on an unknown level', () => {
    const file = envFile('log-level.env', '');
    expect(loadConfig({ env: { HOMESTREAM_ENV_FILE: file }, repoRoot: null }).logLevel).toBe('info');
    expect(loadConfig({ env: { HOMESTREAM_ENV_FILE: file, LOG_LEVEL: 'DEBUG' }, repoRoot: null }).logLevel).toBe(
      'debug',
    );
    const bad = loadConfig({ env: { HOMESTREAM_ENV_FILE: file, LOG_LEVEL: 'chatty' }, repoRoot: null });
    expect(bad.logLevel).toBe('info');
    expect(bad.warnings.join('\n')).toContain('LOG_LEVEL');
  });

  it('advertises on the network unless HOMESTREAM_MDNS is off', () => {
    const file = envFile('mdns.env', '');
    const mdns = (value?: string): boolean =>
      loadConfig({
        env: { HOMESTREAM_ENV_FILE: file, ...(value === undefined ? {} : { HOMESTREAM_MDNS: value }) },
        repoRoot: null,
      }).mdnsEnabled;
    expect(mdns()).toBe(true);
    expect(mdns('on')).toBe(true);
    expect(mdns('off')).toBe(false);
    expect(mdns('OFF')).toBe(false);
    expect(mdns('0')).toBe(false);
  });

  it('names only the keys that are missing', () => {
    const file = envFile('partial.env', 'GATEWAY_MANIFEST_URL=https://gw.test/stremio/a/b/manifest.json\n');
    const config = loadConfig({ env: { HOMESTREAM_ENV_FILE: file }, repoRoot: null });
    expect(config.missingKeys).toEqual(['TMDB_READ_TOKEN']);
  });

  it('lets process env override file values', () => {
    const file = envFile('override.env', 'PORT=8606\nSERVER_NAME=From File\n');
    const config = loadConfig({ env: { HOMESTREAM_ENV_FILE: file, PORT: '8607' }, repoRoot: null });
    expect(config.port).toBe(8607);
    expect(config.serverName).toBe('From File');
  });

  it('ignores empty process env values instead of masking the file', () => {
    const file = envFile('empty-override.env', 'PORT=8606\n');
    expect(loadConfig({ env: { HOMESTREAM_ENV_FILE: file, PORT: '  ' }, repoRoot: null }).port).toBe(8606);
  });

  it('falls back with a warning on an invalid PORT', () => {
    const config = loadConfig({
      env: { HOMESTREAM_ENV_FILE: envFile('badport.env', 'PORT=banana\n') },
      repoRoot: null,
    });
    expect(config.port).toBe(8600);
    expect(config.warnings.join(' ')).toContain('PORT');
  });

  it('puts the source proxy on PORT+50 unless SOURCE_PROXY_PORT overrides it', () => {
    const file = envFile('proxyport.env', 'PORT=8606\n');
    expect(loadConfig({ env: { HOMESTREAM_ENV_FILE: file }, repoRoot: null }).sourceProxyPort).toBe(8656);
    expect(
      loadConfig({ env: { HOMESTREAM_ENV_FILE: file, SOURCE_PROXY_PORT: '8690' }, repoRoot: null }).sourceProxyPort,
    ).toBe(8690);
    expect(loadConfig({ env: { HOMESTREAM_ENV_FILE: file, PORT: '0' }, repoRoot: null }).sourceProxyPort).toBe(0);
    const bad = loadConfig({ env: { HOMESTREAM_ENV_FILE: file, SOURCE_PROXY_PORT: 'banana' }, repoRoot: null });
    expect(bad.sourceProxyPort).toBe(8656);
    expect(bad.warnings.join(' ')).toContain('SOURCE_PROXY_PORT');
  });

  it('prefers HOMESTREAM_ENV_FILE over the repo .env, and the repo .env over %APPDATA%', () => {
    const repo = path.join(root, 'repo');
    const appData = path.join(root, 'appdata');
    mkdirSync(path.join(appData, 'HomeStream'), { recursive: true });
    mkdirSync(repo, { recursive: true });
    writeFileSync(path.join(repo, '.env'), 'SERVER_NAME=repo\n');
    writeFileSync(path.join(appData, 'HomeStream', 'config.env'), 'SERVER_NAME=appdata\n');
    const explicit = envFile('explicit.env', 'SERVER_NAME=explicit\n');

    expect(loadConfig({ env: { HOMESTREAM_ENV_FILE: explicit, APPDATA: appData }, repoRoot: repo }).serverName).toBe(
      'explicit',
    );
    const fromRepo = loadConfig({ env: { APPDATA: appData }, repoRoot: repo });
    expect(fromRepo.serverName).toBe('repo');
    expect(fromRepo.configFile.source).toBe('repo');
    const fromAppData = loadConfig({ env: { APPDATA: appData }, repoRoot: null });
    expect(fromAppData.serverName).toBe('appdata');
    expect(fromAppData.configFile.source).toBe('appdata');
  });

  it('reports the %APPDATA% path when no config file exists in a packaged setup', () => {
    const appData = path.join(root, 'no-config');
    const config = loadConfig({ env: { APPDATA: appData }, repoRoot: null });
    expect(config.configFile).toEqual({
      path: path.join(appData, 'HomeStream', 'config.env'),
      exists: false,
      source: 'appdata',
    });
    expect(config.missingKeys).toHaveLength(2);
  });

  it('registers loaded secrets with the redactor', () => {
    const file = envFile(
      'secrets.env',
      'GATEWAY_MANIFEST_URL=https://gw.test/stremio/uuidpart1234/blobpart5678/manifest.json\nTMDB_READ_TOKEN=tmdbtokenvalue\nTORBOX_API_KEY=torboxkeyvalue\n',
    );
    loadConfig({ env: { HOMESTREAM_ENV_FILE: file }, repoRoot: null });
    const out = redact('uuidpart1234 blobpart5678 tmdbtokenvalue torboxkeyvalue');
    expect(out).toBe('<redacted> <redacted> <redacted> <redacted>');
  });

  describe('DISK_WARN_FREE_GB', () => {
    const load = (name: string, content: string) =>
      loadConfig({ env: { HOMESTREAM_ENV_FILE: envFile(name, content) }, repoRoot: null });

    it('defaults to 20 GB without a warning', () => {
      const config = load('disk-default.env', '# nothing\n');
      expect(config.diskWarnFreeGb).toBe(20);
      expect(config.warnings.join(' ')).not.toContain('DISK_WARN_FREE_GB');
    });

    it('reads a whole or fractional value, and 0 to switch the low-space warning off', () => {
      expect(load('disk-set.env', 'DISK_WARN_FREE_GB=150\n').diskWarnFreeGb).toBe(150);
      expect(load('disk-fraction.env', 'DISK_WARN_FREE_GB=7.5\n').diskWarnFreeGb).toBe(7.5);
      const off = load('disk-off.env', 'DISK_WARN_FREE_GB=0\n');
      expect(off.diskWarnFreeGb).toBe(0);
      expect(off.warnings.join(' ')).toContain('DISK_WARN_FREE_GB');
    });

    it.each(['abc', '-1', '-0.5', 'Infinity', '12GB'])('falls back to 20 with a config warning for %s', (raw) => {
      const config = load(`disk-bad-${raw}.env`, `DISK_WARN_FREE_GB=${raw}\n`);
      expect(config.diskWarnFreeGb).toBe(20);
      expect(config.warnings).toContainEqual(
        expect.stringMatching(/DISK_WARN_FREE_GB=".*" is not a number of GB of 0 or more; using 20\./),
      );
    });

    it('warns that a value at or below the 5 GB error level never produces a warning on its own', () => {
      const config = load('disk-below-error.env', 'DISK_WARN_FREE_GB=3\n');
      expect(config.diskWarnFreeGb).toBe(3);
      expect(config.warnings.join(' ')).toMatch(/DISK_WARN_FREE_GB=3.*5 GB/);
    });
  });
});
