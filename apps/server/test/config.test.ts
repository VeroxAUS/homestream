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
    expect(config.dataDir).toBe('D:\\HomeStream\\data');
    expect(config.transcodeDir).toBe('D:\\HomeStream\\transcode');
    expect(config.transcodeMaxGb).toBe(20);
    expect(config.ffmpegPath).toBe('ffmpeg');
    expect(config.serverName).toMatch(/^HomeStream on /);
    expect(config.missingKeys).toEqual(['GATEWAY_MANIFEST_URL', 'TMDB_READ_TOKEN']);
    expect(config.configFile).toMatchObject({ path: file, exists: true, source: 'env' });
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
    const config = loadConfig({ env: { HOMESTREAM_ENV_FILE: envFile('badport.env', 'PORT=banana\n') }, repoRoot: null });
    expect(config.port).toBe(8600);
    expect(config.warnings.join(' ')).toContain('PORT');
  });

  it('prefers HOMESTREAM_ENV_FILE over the repo .env, and the repo .env over %APPDATA%', () => {
    const repo = path.join(root, 'repo');
    const appData = path.join(root, 'appdata');
    mkdirSync(path.join(appData, 'HomeStream'), { recursive: true });
    mkdirSync(repo, { recursive: true });
    writeFileSync(path.join(repo, '.env'), 'SERVER_NAME=repo\n');
    writeFileSync(path.join(appData, 'HomeStream', 'config.env'), 'SERVER_NAME=appdata\n');
    const explicit = envFile('explicit.env', 'SERVER_NAME=explicit\n');

    expect(loadConfig({ env: { HOMESTREAM_ENV_FILE: explicit, APPDATA: appData }, repoRoot: repo }).serverName).toBe('explicit');
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
});
