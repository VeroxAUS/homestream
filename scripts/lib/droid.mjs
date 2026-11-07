import { spawn } from 'node:child_process';
import { neutralizeMentions, redactValues } from './github.mjs';

const DROID_TIMEOUT_MS = 25 * 60_000;
const MAX_FINDINGS = 15;
const MAX_TEXT = 1500;
const SEVERITIES = ['high', 'medium', 'low'];

/** The text of the final answer in the JSON that `droid exec -o json` prints. */
export function parseDroidOutput(stdout) {
  const lines = String(stdout).trim().split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i].trim();
    if (!line.startsWith('{')) continue;
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (parsed.type !== 'result') continue;
    if (parsed.is_error) throw new Error(`droid reported an error: ${String(parsed.result ?? '').slice(0, 300)}`);
    return String(parsed.result ?? '');
  }
  throw new Error('droid printed no result object');
}

/** The JSON object an answer contains: a fenced ```json block, a bare object, or the first balanced {...} span. */
export function extractJsonObject(text) {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidates = [fenced?.[1], text, text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const value = JSON.parse(candidate.trim());
      if (value && typeof value === 'object' && !Array.isArray(value)) return value;
    } catch {
      // try the next shape
    }
  }
  return null;
}

const clean = (value, max = MAX_TEXT) =>
  neutralizeMentions(String(value ?? ''))
    .replace(/<!--[\s\S]*?-->/g, '')
    .trim()
    .slice(0, max);

function normalizeFinding(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const body = clean(raw.body ?? raw.detail);
  const title = clean(raw.title, 140);
  if (!title && !body) return null;
  const line = Number.parseInt(String(raw.line ?? ''), 10);
  const severity = String(raw.severity ?? 'medium').toLowerCase();
  return {
    path: typeof raw.path === 'string' ? raw.path.replace(/^\.?\/+/, '').replaceAll('\\', '/') : '',
    line: Number.isInteger(line) && line > 0 ? line : 0,
    severity: SEVERITIES.includes(severity) ? severity : 'medium',
    category: clean(raw.category, 40),
    title: title || body.slice(0, 80),
    body,
  };
}

/** A review in the shape the scripts post: `{summary, findings}`. Text that is not JSON becomes the summary. */
export function normalizeReview(answer) {
  const parsed = extractJsonObject(answer);
  if (!parsed) return { summary: clean(answer, 4000), findings: [], structured: false };
  const findings = (Array.isArray(parsed.findings) ? parsed.findings : [])
    .map(normalizeFinding)
    .filter(Boolean)
    .slice(0, MAX_FINDINGS);
  return { summary: clean(parsed.summary, 4000), findings, structured: true };
}

// Without a shell tool the review never asks for a permission that a non-interactive run cannot grant.
const READ_ONLY_TOOLS = 'Read,Grep,Glob,LS';

/**
 * Runs `droid exec` read-only with the prompt in a file and returns the answer text. The key stays in the environment;
 * anything printed from the child's stderr passes through redactValues first.
 */
export function runDroid({ promptFile, cwd, env = process.env, spawnImpl = spawn, timeoutMs = DROID_TIMEOUT_MS }) {
  return new Promise((resolve, reject) => {
    const args = [
      'exec',
      '--output-format',
      'json',
      '--only-tools',
      READ_ONLY_TOOLS,
      '--file',
      promptFile,
      '--cwd',
      cwd,
    ];
    const child = spawnImpl('droid', args, {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const secrets = [env.FACTORY_API_KEY, env.GITHUB_TOKEN];
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`droid exec did not finish within ${Math.round(timeoutMs / 60_000)} minutes`));
    }, timeoutMs);
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(new Error(`could not start droid: ${redactValues(error.message, secrets)}`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        const tail = redactValues(stderr || stdout, secrets)
          .replace(/\s+/g, ' ')
          .slice(-400);
        reject(new Error(`droid exec exited with ${code}: ${tail}`));
        return;
      }
      try {
        resolve(parseDroidOutput(stdout));
      } catch (error) {
        reject(error);
      }
    });
  });
}
