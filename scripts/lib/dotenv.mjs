import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

/** Reads `KEY=value` lines of the repository `.env` into an object. Values stay in memory; nothing is printed. */
export function readDotEnv(root) {
  const file = path.join(root, '.env');
  const values = {};
  if (!existsSync(file)) return values;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match) continue;
    const raw = match[2] ?? '';
    values[match[1] ?? ''] = /^(['"]).*\1$/.test(raw) ? raw.slice(1, -1) : raw;
  }
  return values;
}

/** The process environment wins over `.env`; empty values count as unset. */
export function resolveEnv(root, env = process.env) {
  const merged = { ...readDotEnv(root) };
  for (const [key, value] of Object.entries(env)) if (value) merged[key] = value;
  return merged;
}
