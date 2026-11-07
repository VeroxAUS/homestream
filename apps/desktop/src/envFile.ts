import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';

/** Server default when DATA_DIR is not set; the same default the server itself uses. */
export const DEFAULT_DATA_DIR = 'E:\\HomeStream\\data';
const DEFAULT_PORT = 8600;

/** The only keys the shell copies from the config file into its own environment. The server reads the file by itself. */
const SHELL_KEYS = [
  'SENTRY_DSN_WEB',
  'SENTRY_ENVIRONMENT',
  'POSTHOG_API_KEY',
  'POSTHOG_HOST',
  'HOMESTREAM_TELEMETRY',
  'DATA_DIR',
  'PORT',
] as const;

export interface EnvFileLocation {
  env: NodeJS.ProcessEnv;
  packaged: boolean;
  /** The repository root in development (`apps/desktop/../..`); ignored when packaged. */
  repoRoot: string | null;
  appData: string;
  exists?: (file: string) => boolean;
}

/** Packaged: the config file in %APPDATA%. Development: the repository `.env`. `HOMESTREAM_ENV_FILE` wins in both. */
export function resolveEnvFile(location: EnvFileLocation): string {
  const explicit = location.env.HOMESTREAM_ENV_FILE?.trim();
  if (explicit) return explicit;
  const appDataFile = path.join(location.appData, 'HomeStream', 'config.env');
  if (location.packaged || !location.repoRoot) return appDataFile;
  const exists = location.exists ?? existsSync;
  const repoEnv = path.join(location.repoRoot, '.env');
  return exists(repoEnv) || !exists(appDataFile) ? repoEnv : appDataFile;
}

/** Copies the shell's keys from the file into `env` without overriding what is already set. Returns the keys it set. */
export function loadShellEnv(
  file: string,
  env: NodeJS.ProcessEnv,
  readText: (file: string) => string | null = (target) => {
    try {
      return readFileSync(target, 'utf8');
    } catch {
      return null;
    }
  },
): string[] {
  const text = readText(file);
  if (text === null) return [];
  const values = parseEnv(text);
  const loaded: string[] = [];
  for (const key of SHELL_KEYS) {
    const value = values[key]?.trim();
    if (value && !env[key]?.trim()) {
      env[key] = value;
      loaded.push(key);
    }
  }
  return loaded;
}

export function dataDirFrom(env: NodeJS.ProcessEnv): string {
  return env.DATA_DIR?.trim() || DEFAULT_DATA_DIR;
}

export function portFrom(env: NodeJS.ProcessEnv): number {
  const port = Number(env.PORT);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : DEFAULT_PORT;
}

const CONFIG_TEMPLATE = [
  '# HomeStream settings. Paste each value after its = sign, save the file, then restart the server.',
  'TMDB_READ_TOKEN=',
  'GATEWAY_MANIFEST_URL=',
  'TORBOX_API_KEY=',
  '',
].join('\r\n');

/**
 * The file "Open config.env" shows. Only a path that ends in `.env` is ever opened. A missing file is created with the
 * key names and empty values, so Notepad does not ask to create it.
 */
export function prepareConfigFile(file: string): boolean {
  if (!file.toLowerCase().endsWith('.env')) return false;
  if (!existsSync(file)) {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, CONFIG_TEMPLATE, { flag: 'wx' });
  }
  return true;
}
