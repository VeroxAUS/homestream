import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { git, isMain, repoRoot, splitNul } from './lib/util.mjs';

/**
 * Staged-change secret scan. Runs gitleaks (PATH, GITLEAKS_PATH or D:\HomeStream\tools\gitleaks) with .gitleaks.toml
 * when it is available, otherwise the built-in patterns below, which mirror the custom rules in .gitleaks.toml.
 * The literal match against the values of the local .env files always runs because no pattern knows those values.
 * Findings name the rule and location; secret values are never printed.
 */

export const PATTERNS = [
  { id: 'jwt', regex: /\beyJ[A-Za-z0-9_-]{16,}/ },
  { id: 'torbox-api-key', regex: /TORBOX_API_KEY\s*[=:]\s*['"]?[A-Za-z0-9_-]{16,}/ },
  { id: 'torbox-cdn-host', regex: /\b[a-z0-9-]+\.tb-cdn\.io\b/i },
  { id: 'gateway-manifest', regex: /\baiostreams-[a-z0-9_-]{8,}/ },
  { id: 'posthog-key', regex: /\bph[cx]_[A-Za-z0-9]{30,}/ },
  { id: 'sentry-token', regex: /\bsntry[su]_[A-Za-z0-9+/=_-]{20,}/ },
  { id: 'sentry-dsn', regex: /https:\/\/[0-9a-f]{20,}@[a-z0-9.-]*sentry\.io\/\d+/i },
  { id: 'private-key', regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
];

/** Staged paths that must never be committed, whatever they contain. */
export const BLOCKED_PATHS = [
  { id: 'env-file', regex: /(^|\/)\.env(\.(?!example$)[^/]+)?$/ },
  { id: 'private-key-file', regex: /\.(pem|key|keystore|jks|p12|pfx)$/i },
  { id: 'log-file', regex: /\.log$/i },
];

/** Lockfiles carry integrity hashes that look like secrets. */
const SCAN_SKIP_PATHS = [/(^|\/)pnpm-lock\.yaml$/];
const ALLOW_MARKER = 'gitleaks:allow';
const MIN_ENV_VALUE_LENGTH = 12;
/** Local settings that are not secrets and appear in docs and tests. */
const NON_SECRET_ENV_KEYS = new Set(['POSTHOG_HOST', 'SENTRY_ORG']);

/** Added lines of a unified diff as `{file, line, text}`. */
export function addedLines(diff) {
  const added = [];
  let file = null;
  let line = 0;
  for (const raw of diff.split('\n')) {
    if (raw.startsWith('+++ ')) {
      file = raw === '+++ /dev/null' ? null : raw.slice(6);
    } else if (raw.startsWith('@@')) {
      line = Number(/\+(\d+)/.exec(raw)?.[1] ?? 0);
    } else if (raw.startsWith('+') && file) {
      added.push({ file, line, text: raw.slice(1) });
      line += 1;
    }
  }
  return added;
}

export function parseEnvValues(content) {
  const values = [];
  for (const raw of content.split(/\r?\n/)) {
    if (raw.trimStart().startsWith('#')) continue;
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(raw);
    if (!match) continue;
    const [, key, rawValue] = match;
    const value = rawValue.replace(/^(['"])(.*)\1$/, '$2');
    if (value.length >= MIN_ENV_VALUE_LENGTH && !NON_SECRET_ENV_KEYS.has(key)) values.push({ key, value });
  }
  return values;
}

const scannable = ({ file, text }) => !text.includes(ALLOW_MARKER) && !SCAN_SKIP_PATHS.some((skip) => skip.test(file));

export function scanPatterns(lines) {
  return lines
    .filter(scannable)
    .flatMap(({ file, line, text }) =>
      PATTERNS.filter(({ regex }) => regex.test(text)).map(({ id }) => ({ file, line, rule: id })),
    );
}

export function scanLiterals(lines, envValues) {
  return lines
    .filter(scannable)
    .flatMap(({ file, line, text }) =>
      envValues
        .filter(({ value }) => text.includes(value))
        .map(({ key }) => ({ file, line, rule: `literal value of ${key} from a local .env file` })),
    );
}

export function scanPaths(files) {
  return files.flatMap((file) =>
    BLOCKED_PATHS.filter(({ regex }) => regex.test(file)).map(({ id }) => ({ file, line: 0, rule: id })),
  );
}

/** GITLEAKS_PATH wins and, when it points nowhere, disables gitleaks (the built-in scan takes over). */
export function findGitleaks(env = process.env) {
  const exe = process.platform === 'win32' ? 'gitleaks.exe' : 'gitleaks';
  if (env.GITLEAKS_PATH) return existsSync(env.GITLEAKS_PATH) ? env.GITLEAKS_PATH : null;
  const dirs = (env.PATH ?? env.Path ?? '').split(path.delimiter).filter(Boolean);
  const candidates = [...dirs.map((dir) => path.join(dir, exe)), path.join('D:\\HomeStream\\tools\\gitleaks', exe)];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function localEnvValues(root, env) {
  const files = [path.join(root, '.env'), path.join(root, '.env.local'), env.HOMESTREAM_ENV_FILE];
  if (env.APPDATA) files.push(path.join(env.APPDATA, 'HomeStream', 'config.env'));
  return files.filter((file) => file && existsSync(file)).flatMap((file) => parseEnvValues(readFileSync(file, 'utf8')));
}

/** Findings of a gitleaks JSON report as `{file, line, rule}`; the matched text is never read. */
export function parseGitleaksReport(json) {
  const entries = json.trim() ? JSON.parse(json) : [];
  return entries.map((entry) => ({ file: entry.File, line: entry.StartLine, rule: entry.RuleID }));
}

/** Without `--verbose` gitleaks prints no per-finding text at all, so the locations come from a JSON report. */
function runGitleaks(binary, root) {
  const reportDir = mkdtempSync(path.join(tmpdir(), 'homestream-gitleaks-'));
  const reportPath = path.join(reportDir, 'report.json');
  try {
    const result = spawnSync(
      binary,
      [
        'git',
        '--staged',
        '--redact',
        '--no-banner',
        '--log-level',
        'error',
        '--config',
        path.join(root, '.gitleaks.toml'),
        '--exit-code',
        '2',
        '--report-format',
        'json',
        '--report-path',
        reportPath,
      ],
      { cwd: root, encoding: 'utf8', windowsHide: true },
    );
    if (result.status === 0) return { ok: true, findings: [] };
    if (result.status === 2) {
      const findings = existsSync(reportPath) ? parseGitleaksReport(readFileSync(reportPath, 'utf8')) : [];
      return { ok: false, findings };
    }
    return { error: result.error?.message ?? `exit ${result.status}` };
  } finally {
    rmSync(reportDir, { recursive: true, force: true });
  }
}

function report(findings) {
  for (const { file, line, rule } of findings) {
    console.error(`[secrets] BLOCKED ${file}${line ? `:${line}` : ''} (${rule})`);
  }
  console.error(
    '[secrets] Remove the secret or, for a fake test value, shorten it or add "gitleaks:allow" to the line.',
  );
}

export function main(cwd = process.cwd(), env = process.env) {
  const root = repoRoot(cwd);
  const staged = splitNul(git(['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'], { cwd: root }));
  const diffArgs = [
    '-c',
    'core.quotepath=off',
    'diff',
    '--cached',
    '-U0',
    '--no-color',
    '--no-ext-diff',
    '--diff-filter=ACMR',
  ];
  const lines = addedLines(git(diffArgs, { cwd: root }));
  const findings = [...scanPaths(staged), ...scanLiterals(lines, localEnvValues(root, env))];

  let engine = 'built-in patterns';
  let gitleaksFailed = false;
  const binary = findGitleaks(env);
  if (binary) {
    const result = runGitleaks(binary, root);
    if (result.error) {
      console.error(`[secrets] gitleaks could not run (${result.error}); using the built-in patterns`);
    } else {
      engine = 'gitleaks';
      gitleaksFailed = !result.ok;
      findings.push(...result.findings);
    }
  }
  if (engine === 'built-in patterns') findings.push(...scanPatterns(lines));

  if (findings.length > 0 || gitleaksFailed) {
    report(findings);
    return 1;
  }
  console.log(`[secrets] ok (${engine}, ${lines.length} added lines)`);
  return 0;
}

if (isMain(import.meta.url)) process.exit(main());
