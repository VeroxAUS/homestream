import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { KNOWN_KEYS } from '../src/config.js';

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');
const example = readFileSync(path.join(repoRoot, '.env.example'), 'utf8');

/** Telemetry and runtime switches that are read outside the server config loader. */
const EXTRA_KEYS = [
  'HOMESTREAM_ENV_FILE',
  'HOMESTREAM_PACKAGED',
  'HOMESTREAM_TELEMETRY',
  'SENTRY_DSN_SERVER',
  'SENTRY_DSN_WEB',
  'SENTRY_DSN_TV',
  'SENTRY_ORG',
  'SENTRY_AUTH_TOKEN',
  'SENTRY_API_TOKEN',
  'POSTHOG_API_KEY',
  'POSTHOG_HOST',
  'POSTHOG_PERSONAL_API_KEY',
  'HOMESTREAM_TEST_ROOT',
  'GITLEAKS_PATH',
];

/** Variables the operating system or CI provide; nothing to configure. */
const SYSTEM_VARIABLES = new Set(['APPDATA', 'CI', 'PATH', 'Path', 'TEMP', 'TMP', 'HOME', 'USERPROFILE']);

/** Keys with an assignment line, commented or not: `KEY=` or `# KEY=`. */
function assignedKeys(text: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const line of text.split('\n')) {
    const match = /^#?\s*([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (match) found.set(match[1] as string, (match[2] ?? '').trim());
  }
  return found;
}

function missingFrom(text: string, keys: readonly string[]): string[] {
  const present = assignedKeys(text);
  return keys.filter((key) => !present.has(key));
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (['node_modules', 'dist', 'coverage'].includes(name)) return [];
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx|mjs)$/.test(name) && !name.endsWith('.d.mts') ? [full] : [];
  });
}

function envVariablesRead(): Set<string> {
  const roots = ['apps/server/src', 'apps/web/src', 'apps/desktop/src', 'scripts'].map((dir) =>
    path.join(repoRoot, dir),
  );
  const found = new Set<string>();
  for (const root of roots) {
    try {
      statSync(root);
    } catch {
      continue;
    }
    for (const file of sourceFiles(root)) {
      const text = readFileSync(file, 'utf8');
      for (const match of text.matchAll(/\b(?:process\.env|env)\.([A-Z][A-Z0-9_]+)\b/g)) found.add(match[1] as string);
    }
  }
  return found;
}

describe('.env.example', () => {
  it('lists every key of the server config (KNOWN_KEYS)', () => {
    expect(missingFrom(example, KNOWN_KEYS)).toEqual([]);
  });

  it('lists the telemetry, runtime and tooling keys', () => {
    expect(missingFrom(example, EXTRA_KEYS)).toEqual([]);
  });

  it('lists every environment variable the code reads', () => {
    const read = [...envVariablesRead()].filter((name) => !SYSTEM_VARIABLES.has(name));
    expect(read.length).toBeGreaterThan(0);
    expect(missingFrom(example, read)).toEqual([]);
  });

  it('contains no values and no secret-looking text', () => {
    for (const [key, value] of assignedKeys(example)) expect(value, `${key} must not have a value`).toBe('');
    expect(example).not.toMatch(/eyJ[\w-]{10,}/);
    expect(example).not.toMatch(/\b(?:phc|phx|sntrys|sntryu)_[A-Za-z0-9]{10,}/);
    expect(example).not.toMatch(/aiostreams-[\w-]{8,}/i);
    expect(example).not.toMatch(/https?:\/\/(?!api\.torbox\.app\b|torbox\.app\b|themoviedb\.org\b)\S+/);
  });

  it('fails the check when a config key is missing', () => {
    const withoutKey = example
      .split('\n')
      .filter((line) => !/^#?\s*MAX_DOWNLOAD_MBPS=/.test(line))
      .join('\n');
    expect(missingFrom(withoutKey, KNOWN_KEYS)).toEqual(['MAX_DOWNLOAD_MBPS']);
  });

  it('is not ignored by git while .env is', () => {
    const ignore = readFileSync(path.join(repoRoot, '.gitignore'), 'utf8');
    expect(ignore).toMatch(/^\.env$/m);
    expect(ignore).toMatch(/^!\.env\.example$/m);
  });
});
