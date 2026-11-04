import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLogger } from '../src/logger.js';
import { clearSecrets, registerSecret, registerSecretUrl } from '../src/redact.js';
import { makeTempDir, removeDir } from './helpers.js';

let root: string;
beforeAll(() => {
  root = makeTempDir('logger');
});
afterAll(() => {
  clearSecrets();
  removeDir(root);
});

describe('createLogger', () => {
  it('writes redacted JSON lines to DATA_DIR/server.log', async () => {
    registerSecret('tmdb-secret-token-abc');
    registerSecretUrl('https://gw.test/stremio/uuidsecret111/blobsecret222/manifest.json');
    const dataDir = path.join(root, 'data');
    const appLogger = createLogger({ dataDir, stdout: false });
    appLogger.logger.info('token is tmdb-secret-token-abc');
    appLogger.logger.warn({ url: 'https://gw.test/stremio/uuidsecret111/blobsecret222/stream/movie/tt1.json?apikey=zzz999' }, 'fetch');
    appLogger.logger.error({ token: 'plain', headers: { authorization: 'Bearer abcdefghij' } }, 'object fields');
    await appLogger.close();

    const content = readFileSync(path.join(dataDir, 'server.log'), 'utf8');
    for (const secret of ['tmdb-secret-token-abc', 'uuidsecret111', 'blobsecret222', 'zzz999', 'abcdefghij']) {
      expect(content).not.toContain(secret);
    }
    expect(content).not.toContain('"token":"plain"');
    const lines = content.trim().split('\n').map((line) => JSON.parse(line) as { msg: string });
    expect(lines.map((l) => l.msg)).toEqual(['token is <redacted>', 'fetch', 'object fields']);
  });
});
