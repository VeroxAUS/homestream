import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { resolveDownloadLimits } from './network/limits.js';
import { DEFAULT_MAX_RSS_MB } from './playback/memoryWatchdog.js';
import { registerSecret, registerSecretUrl } from './redact.js';

export const REQUIRED_KEYS = ['GATEWAY_MANIFEST_URL', 'TMDB_READ_TOKEN'] as const;
type RequiredKey = (typeof REQUIRED_KEYS)[number];

/** Every setting the server reads from the process environment or the config file; `.env.example` must list each one. */
export const KNOWN_KEYS = [
  ...REQUIRED_KEYS,
  'TORBOX_API_KEY',
  'TORBOX_API_URL',
  'PORT',
  'DATA_DIR',
  'TRANSCODE_DIR',
  'TRANSCODE_MAX_GB',
  'FFMPEG_PATH',
  'FFPROBE_PATH',
  'FFMPEG_THREADS',
  'FFMPEG_BURN_THREADS',
  'FFMPEG_MAX_RSS_MB',
  'SERVER_NAME',
  'SOURCE_PROXY_PORT',
  'MAX_DOWNLOAD_MBPS',
  'READ_AHEAD_SEC',
  'READ_AHEAD_RESUME_SEC',
  'HOMESTREAM_WEB_DIR',
  'HEALTH_NVENC_TEST',
  'LOG_LEVEL',
] as const;

const DEFAULT_PORT = 8600;
const SOURCE_PROXY_PORT_OFFSET = 50;

interface ConfigFileInfo {
  path: string;
  exists: boolean;
  source: 'env' | 'repo' | 'appdata';
}

export interface Config {
  host: string;
  port: number;
  /** Loopback source proxy port; 0 picks a free port. Never reachable from the LAN. */
  sourceProxyPort: number;
  dataDir: string;
  transcodeDir: string;
  transcodeMaxGb: number;
  ffmpegPath: string;
  ffprobePath: string;
  /** Thread cap for ffmpeg jobs whose filters run on the GPU. */
  ffmpegThreads: number;
  /** Thread cap for jobs with CPU filters (software burn-in, CPU overlay, CPU tone mapping). */
  ffmpegBurnThreads: number;
  /** Working-set limit per ffmpeg process in MiB; the memory watchdog stops a process above it. */
  ffmpegMaxRssMb: number;
  /** Hard cap on all upstream CDN downloads together, in megabits per second. */
  maxDownloadMbps: number;
  /** The encoder runs at most this many seconds ahead of the player before its reads wait. */
  readAheadSec: number;
  /** Reading resumes once the lead is below this many seconds. */
  readAheadResumeSec: number;
  /** Whether the ffmpeg health check runs its 1 s NVENC test encode. Off: only versions and encoder names are checked. */
  healthNvencTest: boolean;
  /** Console and server.log verbosity; `debug` adds the playback start timing lines. */
  logLevel: LogLevel;
  serverName: string;
  gatewayManifestUrl: string | null;
  tmdbReadToken: string | null;
  torboxApiKey: string | null;
  /** TorBox API origin used by the download poller; only tests and local stubs change it. */
  torboxApiUrl: string;
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

function appDataConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  const appData = env.APPDATA?.trim() || path.join(os.homedir(), 'AppData', 'Roaming');
  return path.join(appData, 'HomeStream', 'config.env');
}

function resolveConfigFile(env: NodeJS.ProcessEnv, repoRoot: string | null | undefined): ConfigFileInfo {
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

function positiveInteger(raw: string | undefined, fallback: number, name: string, warnings: string[]): number {
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    warnings.push(`${name}="${raw}" is not a positive whole number; using ${fallback}.`);
    return fallback;
  }
  return value;
}

const DEFAULT_TORBOX_API_URL = 'https://api.torbox.app';

const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
type LogLevel = (typeof LOG_LEVELS)[number];

function logLevelFrom(raw: string | undefined, warnings: string[]): LogLevel {
  if (raw === undefined) return 'info';
  const level = LOG_LEVELS.find((candidate) => candidate === raw.toLowerCase());
  if (level) return level;
  warnings.push(`LOG_LEVEL="${raw}" is not one of ${LOG_LEVELS.join(', ')}; using info.`);
  return 'info';
}

function httpOrigin(raw: string | undefined, fallback: string, name: string, warnings: string[]): string {
  if (raw === undefined) return fallback;
  try {
    const url = new URL(raw);
    if (url.protocol === 'http:' || url.protocol === 'https:') return url.origin;
  } catch {
    // reported below
  }
  warnings.push(`${name} is not an http(s) URL; using ${fallback}.`);
  return fallback;
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

  let sourceProxyPort = port === 0 ? 0 : port + SOURCE_PROXY_PORT_OFFSET;
  const proxyPortRaw = values.SOURCE_PROXY_PORT;
  if (proxyPortRaw !== undefined) {
    const parsed = Number(proxyPortRaw);
    if (Number.isInteger(parsed) && parsed >= 0 && parsed <= 65535) sourceProxyPort = parsed;
    else warnings.push(`SOURCE_PROXY_PORT="${proxyPortRaw}" is not a valid port; using ${sourceProxyPort}.`);
  }
  if (sourceProxyPort > 65535) sourceProxyPort = 0;

  const limits = resolveDownloadLimits(values, warnings);
  const missingKeys = REQUIRED_KEYS.filter((key) => !values[key]);

  const config: Config = {
    host: '0.0.0.0',
    port,
    sourceProxyPort,
    dataDir: values.DATA_DIR ?? 'E:\\HomeStream\\data',
    transcodeDir: values.TRANSCODE_DIR ?? 'E:\\HomeStream\\transcode',
    transcodeMaxGb: positiveNumber(values.TRANSCODE_MAX_GB, 20, 'TRANSCODE_MAX_GB', warnings),
    ffmpegPath: values.FFMPEG_PATH ?? 'ffmpeg',
    ffprobePath: values.FFPROBE_PATH ?? 'ffprobe',
    ffmpegThreads: positiveInteger(values.FFMPEG_THREADS, 4, 'FFMPEG_THREADS', warnings),
    ffmpegBurnThreads: positiveInteger(values.FFMPEG_BURN_THREADS, 8, 'FFMPEG_BURN_THREADS', warnings),
    ffmpegMaxRssMb: positiveInteger(values.FFMPEG_MAX_RSS_MB, DEFAULT_MAX_RSS_MB, 'FFMPEG_MAX_RSS_MB', warnings),
    maxDownloadMbps: limits.maxDownloadMbps,
    readAheadSec: limits.readAheadSec,
    readAheadResumeSec: limits.readAheadResumeSec,
    healthNvencTest: !/^(0|false|off|no)$/i.test(values.HEALTH_NVENC_TEST ?? ''),
    logLevel: logLevelFrom(values.LOG_LEVEL, warnings),
    serverName: values.SERVER_NAME ?? `HomeStream on ${os.hostname()}`,
    gatewayManifestUrl: values.GATEWAY_MANIFEST_URL ?? null,
    tmdbReadToken: values.TMDB_READ_TOKEN ?? null,
    torboxApiKey: values.TORBOX_API_KEY ?? null,
    torboxApiUrl: httpOrigin(values.TORBOX_API_URL, DEFAULT_TORBOX_API_URL, 'TORBOX_API_URL', warnings),
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
