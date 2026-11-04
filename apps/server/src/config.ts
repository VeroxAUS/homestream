import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { registerSecret, registerSecretUrl } from './redact.js';

export const REQUIRED_KEYS = ['GATEWAY_MANIFEST_URL', 'TMDB_READ_TOKEN'] as const;
export type RequiredKey = (typeof REQUIRED_KEYS)[number];

const KNOWN_KEYS = [
  ...REQUIRED_KEYS,
  'TORBOX_API_KEY',
  'PORT',
  'DATA_DIR',
  'TRANSCODE_DIR',
  'TRANSCODE_MAX_GB',
  'FFMPEG_PATH',
  'FFPROBE_PATH',
  'SERVER_NAME',
  'HOMESTREAM_WEB_DIR',
] as const;

export const DEFAULT_PORT = 8600;

export interface ConfigFileInfo {
  path: string;
  exists: boolean;
  source: 'env' | 'repo' | 'appdata';
}

export interface Config {
  host: string;
  port: number;
  dataDir: string;
  transcodeDir: string;
  transcodeMaxGb: number;
  ffmpegPath: string;
  ffprobePath: string;
  serverName: string;
  gatewayManifestUrl: string | null;
  tmdbReadToken: string | null;
  torboxApiKey: string | null;
  webDir: string | null;
  configFile: ConfigFileInfo;
  missingKeys: RequiredKey[];
  warnings: string[];
}

export interface LoadConfigOptions {
  env?: NodeJS.ProcessEnv;
  /** Repo root holding the dev `.env`; null/undefined in packaged builds. */
  repoRoot?: string | null;
  /** Default location of the built web UI when HOMESTREAM_WEB_DIR is not set. */
  defaultWebDir?: string | null;
}

export function appDataConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  const appData = env.APPDATA?.trim() || path.join(os.homedir(), 'AppData', 'Roaming');
  return path.join(appData, 'HomeStream', 'config.env');
}

export function resolveConfigFile(env: NodeJS.ProcessEnv, repoRoot: string | null | undefined): ConfigFileInfo {
  const explicit = env.HOMESTREAM_ENV_FILE?.trim();
  if (explicit) return { path: explicit, exists: existsSync(explicit), source: 'env' };

  if (repoRoot) {
    const repoEnv = path.join(repoRoot, '.env');
    if (existsSync(repoEnv)) return { path: repoEnv, exists: true, source: 'repo' };
  }

  const appData = appDataConfigPath(env);
  if (existsSync(appData)) return { path: appData, exists: true, source: 'appdata' };

  if (repoRoot) return { path: path.join(repoRoot, '.env'), exists: false, source: 'repo' };
  return { path: appData, exists: false, source: 'appdata' };
}

function readEnvFile(file: ConfigFileInfo, warnings: string[]): Record<string, string> {
  if (!file.exists) return {};
  try {
    return parseEnv(readFileSync(file.path, 'utf8')) as Record<string, string>;
  } catch (error) {
    warnings.push(`Could not read config file ${file.path}: ${(error as Error).message}`);
    return {};
  }
}

function positiveNumber(raw: string | undefined, fallback: number, name: string, warnings: string[]): number {
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    warnings.push(`${name}="${raw}" is not a positive number; using ${fallback}.`);
    return fallback;
  }
  return value;
}

export function loadConfig(options: LoadConfigOptions = {}): Config {
  const env = options.env ?? process.env;
  const warnings: string[] = [];
  const configFile = resolveConfigFile(env, options.repoRoot);
  const fileValues = readEnvFile(configFile, warnings);

  const values: Partial<Record<(typeof KNOWN_KEYS)[number], string>> = {};
  for (const key of KNOWN_KEYS) {
    const fromProcess = env[key]?.trim();
    const fromFile = fileValues[key]?.trim();
    const chosen = fromProcess || fromFile;
    if (chosen) values[key] = chosen;
  }

  const portRaw = values.PORT;
  let port = DEFAULT_PORT;
  if (portRaw !== undefined) {
    const parsed = Number(portRaw);
    if (Number.isInteger(parsed) && parsed >= 0 && parsed <= 65535) port = parsed;
    else warnings.push(`PORT="${portRaw}" is not a valid port; using ${DEFAULT_PORT}.`);
  }

  const missingKeys = REQUIRED_KEYS.filter((key) => !values[key]);

  const config: Config = {
    host: '0.0.0.0',
    port,
    dataDir: values.DATA_DIR ?? 'D:\\HomeStream\\data',
    transcodeDir: values.TRANSCODE_DIR ?? 'D:\\HomeStream\\transcode',
    transcodeMaxGb: positiveNumber(values.TRANSCODE_MAX_GB, 20, 'TRANSCODE_MAX_GB', warnings),
    ffmpegPath: values.FFMPEG_PATH ?? 'ffmpeg',
    ffprobePath: values.FFPROBE_PATH ?? 'ffprobe',
    serverName: values.SERVER_NAME ?? `HomeStream on ${os.hostname()}`,
    gatewayManifestUrl: values.GATEWAY_MANIFEST_URL ?? null,
    tmdbReadToken: values.TMDB_READ_TOKEN ?? null,
    torboxApiKey: values.TORBOX_API_KEY ?? null,
    webDir: values.HOMESTREAM_WEB_DIR ?? options.defaultWebDir ?? null,
    configFile,
    missingKeys,
    warnings,
  };

  registerConfigSecrets(config);
  return config;
}

export function registerConfigSecrets(config: Config): void {
  registerSecretUrl(config.gatewayManifestUrl);
  registerSecret(config.tmdbReadToken);
  registerSecret(config.torboxApiKey);
}
