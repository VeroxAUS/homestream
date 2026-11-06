import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { copyFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { makeTempDir, removeDir } from '../helpers.js';
import { makeTempRepo, runScript, writeAndStage } from './repoHelpers.js';

const roots: string[] = [];
let repo: string;

beforeEach(() => {
  repo = makeTempRepo('precommit');
  roots.push(repo);
});
afterAll(() => {
  for (const dir of roots) removeDir(dir);
});

describe('check-large-files', () => {
  it('rejects a 1.5 MB staged file and names the file and the limit', () => {
    writeAndStage(repo, 'assets/big.bin', randomBytes(1_500_000));
    const result = runScript(repo, 'check-large-files.mjs');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('assets/big.bin');
    expect(result.stderr).toContain('1 MB');
  });

  it('accepts a 400 KB staged file', () => {
    writeAndStage(repo, 'assets/small.bin', randomBytes(400_000));
    expect(runScript(repo, 'check-large-files.mjs').status).toBe(0);
  });

  it('allows a lockfile over the limit', () => {
    writeAndStage(repo, 'pnpm-lock.yaml', randomBytes(1_500_000).toString('hex'));
    expect(runScript(repo, 'check-large-files.mjs').status).toBe(0);
  });

  it('--all also finds an untracked large file in the working tree', () => {
    writeAndStage(repo, 'a.txt', 'hello');
    writeFileSync(path.join(repo, 'untracked.bin'), randomBytes(1_500_000));
    expect(runScript(repo, 'check-large-files.mjs').status).toBe(0);
    const result = runScript(repo, 'check-large-files.mjs', ['--all']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('untracked.bin');
  });
});
describe('pre-commit-secrets (built-in scan, gitleaks disabled)', () => {
  const env = { GITLEAKS_PATH: 'D:\\does-not-exist\\gitleaks.exe' };
  const jwt = () =>
    `eyJ${randomBytes(12).toString('base64url')}.${randomBytes(18).toString('base64url')}.${randomBytes(18).toString('base64url')}`;
  const torboxKey = () => randomBytes(16).toString('hex');
  const posthogKey = () => `phc_${randomBytes(22).toString('hex').slice(0, 43)}`;

  it.each([
    ['a JWT-shaped token', jwt, (v: string) => `const token = "${v}";\n`, 'jwt'],
    ['a TorBox key assignment', torboxKey, (v: string) => `TORBOX_API_KEY=${v}\n`, 'torbox-api-key'],
    ['a PostHog key', posthogKey, (v: string) => `const key = "${v}";\n`, 'posthog-key'],
  ])('blocks %s without echoing it', (_label, makeValue, wrap, rule) => {
    const value = makeValue();
    writeAndStage(repo, 'src/leak.ts', wrap(value));
    const result = runScript(repo, 'pre-commit-secrets.mjs', [], env);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('src/leak.ts:1');
    expect(result.stderr).toContain(rule);
    expect(result.stderr + result.stdout).not.toContain(value);
  });
  it.each([
    ['a single-label host', 'store-1.tb-cdn.io'],
    ['a multi-label host', 'store-12.eu.tb-cdn.io'],
  ])('blocks %s of the TorBox CDN anywhere in a line', (_label, host) => {
    writeAndStage(repo, 'src/leak.ts', `fetch("https://${host}/x");\n`);
    const result = runScript(repo, 'pre-commit-secrets.mjs', [], env);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('torbox-cdn-host');
  });

  it('accepts a look-alike host that does not end in the CDN domain', () => {
    writeAndStage(repo, 'src/ok.ts', 'const a = "tb-cdn.io.example.test"; const b = "nottb-cdn.io";\n');
    expect(runScript(repo, 'pre-commit-secrets.mjs', [], env).status).toBe(0);
  });

  it('blocks a literal copy of a local .env value and never prints it', () => {
    const value = `lit-${randomBytes(10).toString('hex')}`;
    const envDir = makeTempDir('precommit-env');
    roots.push(envDir);
    const envFile = path.join(envDir, 'test.env');
    writeFileSync(envFile, `SOME_SERVICE_TOKEN=${value}\n`);
    writeAndStage(repo, 'notes.md', `the token is ${value}\n`);
    const result = runScript(repo, 'pre-commit-secrets.mjs', [], { ...env, HOMESTREAM_ENV_FILE: envFile });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('SOME_SERVICE_TOKEN');
    expect(result.stderr + result.stdout).not.toContain(value);
  });

  it('blocks a staged .env file but accepts .env.example with empty values', () => {
    writeAndStage(repo, '.env.example', 'TORBOX_API_KEY=\nTMDB_READ_TOKEN=\n');
    expect(runScript(repo, 'pre-commit-secrets.mjs', [], env).status).toBe(0);
    writeAndStage(repo, '.env', 'ANYTHING=1\n');
    const result = runScript(repo, 'pre-commit-secrets.mjs', [], env);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('env-file');
  });

  it('accepts ordinary changes and honours the gitleaks:allow marker', () => {
    writeAndStage(repo, 'src/ok.ts', 'export const answer = 42;\n');
    expect(runScript(repo, 'pre-commit-secrets.mjs', [], env).status).toBe(0);
    writeAndStage(repo, 'src/fixture.ts', `const fake = "eyJ${'a'.repeat(30)}"; // gitleaks:allow\n`);
    expect(runScript(repo, 'pre-commit-secrets.mjs', [], env).status).toBe(0);
  });
});

/** The gitleaks binary on PATH, in GITLEAKS_PATH or in the local tools folder; null when none runs. */
function gitleaksEnv(): Record<string, string> | null {
  const candidates = [process.env.GITLEAKS_PATH, 'gitleaks', 'D:\\HomeStream\\tools\\gitleaks\\gitleaks.exe'];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const probe = spawnSync(candidate, ['version'], { windowsHide: true });
    if (probe.status === 0) return candidate === 'gitleaks' ? {} : { GITLEAKS_PATH: candidate };
  }
  return null;
}

describe.skipIf(gitleaksEnv() === null)('pre-commit-secrets (gitleaks, output captured)', () => {
  beforeEach(() => {
    copyFileSync(
      path.join(import.meta.dirname, '..', '..', '..', '..', '.gitleaks.toml'),
      path.join(repo, '.gitleaks.toml'),
    );
  });

  it('prints file:line and rule id for a finding even though stderr is a pipe, and never the value', () => {
    const value = `eyJ${randomBytes(12).toString('base64url')}.${randomBytes(18).toString('base64url')}.${randomBytes(18).toString('base64url')}`;
    writeAndStage(repo, 'src/leak.ts', `const token = "${value}";\n`);
    const result = runScript(repo, 'pre-commit-secrets.mjs', [], gitleaksEnv() ?? {});
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/\[secrets\] BLOCKED src\/leak\.ts:1 \([a-z-]+\)/);
    expect(result.stderr + result.stdout).not.toContain(value);
  });

  it('passes a clean change', () => {
    writeAndStage(repo, 'src/ok.ts', 'export const answer = 42;\n');
    const result = runScript(repo, 'pre-commit-secrets.mjs', [], gitleaksEnv() ?? {});
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('gitleaks');
  });
});
