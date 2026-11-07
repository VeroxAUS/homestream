// Which running ffmpeg processes belong to HomeStream, for the --require-idle check of scripts/gpu-health.mjs.
// Only a HomeStream encode may exempt the utilization check: any other ffmpeg (a user's own, another app's) must not.
import { readFileSync } from 'node:fs';
import path from 'node:path';

/** Default HomeStream data and transcode locations (config.ts defaults and the D: junction to them). */
const DEFAULT_ROOTS = [
  'E:\\HomeStream\\transcode',
  'D:\\HomeStream\\transcode',
  'E:\\HomeStream\\test-tmp',
  'D:\\HomeStream\\test-tmp',
];
const DEFAULT_DATA_DIRS = ['E:\\HomeStream\\data', 'D:\\HomeStream\\data'];
const PID_FILE_NAME = 'ffmpeg-pids.json';

/** PowerShell that lists every ffmpeg.exe with its command line and creation time (epoch ms) as JSON (empty output when none runs). */
export const FFMPEG_PROCESS_SCRIPT = `
$ErrorActionPreference = 'Stop'
$found = @(Get-CimInstance Win32_Process -Filter "Name='ffmpeg.exe'" | ForEach-Object { [pscustomobject]@{ pid = $_.ProcessId; commandLine = $_.CommandLine; createdAtMs = if ($_.CreationDate) { ([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds() } else { $null } } })
if ($found.Count -gt 0) { ConvertTo-Json -InputObject $found -Compress -Depth 3 }
`;

/**
 * @param {string} stdout JSON produced by FFMPEG_PROCESS_SCRIPT (a bare object, an array or nothing)
 * @returns {Array<{pid: number, commandLine: string | null, createdAtMs: number | null}>}
 */
export function parseFfmpegProcesses(stdout) {
  const text = stdout.trim();
  if (!text) return [];
  const data = JSON.parse(text);
  return (Array.isArray(data) ? data : [data])
    .filter((p) => p && typeof p === 'object' && Number.isInteger(p.pid))
    .map((p) => ({
      pid: p.pid,
      commandLine: typeof p.commandLine === 'string' && p.commandLine ? p.commandLine : null,
      createdAtMs: Number.isFinite(p.createdAtMs) ? p.createdAtMs : null,
    }));
}

/**
 * The server's ffmpeg-pids.json. A missing or broken file yields no entries, which only makes the exemption narrower.
 * @param {string} text
 * @returns {Array<{pid: number, sessionId: string, startedAt?: number, match?: string}>}
 */
export function parsePidRegistry(text) {
  try {
    const parsed = JSON.parse(text);
    if (!parsed || !Array.isArray(parsed.pids)) return [];
    return parsed.pids.filter((e) => e && Number.isInteger(e.pid) && typeof e.sessionId === 'string');
  } catch {
    return [];
  }
}

/** Registry entries of every data directory this machine's server may use. @param {NodeJS.ProcessEnv} env */
export function readPidRegistries(env = process.env, readFile = readFileSync) {
  const dirs = [env.DATA_DIR, ...DEFAULT_DATA_DIRS].filter(Boolean);
  return dirs.flatMap((dir) => {
    try {
      return parsePidRegistry(readFile(path.win32.join(dir, PID_FILE_NAME), 'utf8'));
    } catch {
      return [];
    }
  });
}

/** Directories whose presence on an ffmpeg command line marks it as a HomeStream session or test encode. @param {NodeJS.ProcessEnv} env */
export function ownedRoots(env = process.env) {
  return [env.TRANSCODE_DIR, env.HOMESTREAM_TEST_ROOT, ...DEFAULT_ROOTS].filter(Boolean);
}

const normalise = (text) => text.toLowerCase().replaceAll('/', '\\');

/** Windows paths compare case-insensitively with one separator style; `..` and `.` segments are resolved so they cannot escape a root. */
function normalisePath(text) {
  const unquoted = text.trim().replace(/^["']+|["']+$/g, '');
  return path.win32.normalize(normalise(unquoted));
}

/** Splits a Windows command line into arguments: whitespace separates them, double quotes group (and are dropped). */
function splitCommandLine(line) {
  const args = [];
  let current = '';
  let inQuotes = false;
  let started = false;
  for (const char of line) {
    if (char === '"') {
      inQuotes = !inQuotes;
      started = true;
    } else if (!inQuotes && /\s/.test(char)) {
      if (started) args.push(current);
      current = '';
      started = false;
    } else {
      current += char;
      started = true;
    }
  }
  if (started) args.push(current);
  return args;
}

/**
 * True when an argument is an owned root or a path below it. A bare substring would also accept siblings such as
 * `...\transcode-backup`, so the match must end at a directory boundary.
 */
function hasPathInside(args, roots) {
  const bases = roots
    .map((root) => normalisePath(root))
    .filter((root) => path.win32.isAbsolute(root))
    .map((root) => root.replace(/\\+$/, ''));
  return args.some((arg) => {
    const candidate = normalisePath(arg.replace(/^file:(?:\/\/\/)?/i, ''));
    return bases.some((base) => candidate === base || candidate.startsWith(`${base}\\`));
  });
}

/** A recycled pid starts after the recorded process was spawned; the registry stamps `startedAt` right after the spawn call. */
const START_BEFORE_RECORD_MS = 10_000;
const START_AFTER_RECORD_MS = 2_000;

/**
 * The registry vouches for a process only with evidence that is specific to that process: the recorded session id or per-process
 * `match` text on its command line, and a creation time next to the recorded start. A generic marker (`webvtt`) or a recycled pid
 * shows neither. An unknown creation time is not evidence.
 */
function isRegistered(proc, line, entry) {
  if (line === null || entry === undefined) return false;
  if (typeof proc.createdAtMs !== 'number' || typeof entry.startedAt !== 'number') return false;
  const delta = proc.createdAtMs - entry.startedAt;
  if (delta < -START_BEFORE_RECORD_MS || delta > START_AFTER_RECORD_MS) return false;
  return [entry.sessionId, entry.match].some((needle) => needle && line.includes(normalise(needle)));
}

/**
 * A process is HomeStream's when the PID registry vouches for it (see isRegistered), or when one of its path arguments lies inside a
 * HomeStream transcode or test directory (at a directory boundary, so `transcode-backup` is not `transcode`). A process whose command
 * line cannot be read is never counted as ours, so the utilization check stays in force.
 * @param {Array<{pid: number, commandLine: string | null, createdAtMs?: number | null}>} processes
 * @param {{registry?: Array<{pid: number, sessionId: string, startedAt?: number, match?: string}>, roots?: string[]}} sources
 */
export function countFfmpeg(processes, { registry = [], roots = ownedRoots() } = {}) {
  let owned = 0;
  for (const proc of processes) {
    if (proc.commandLine === null) continue;
    const line = normalise(proc.commandLine);
    const entry = registry.find((e) => e.pid === proc.pid);
    if (isRegistered(proc, line, entry) || hasPathInside(splitCommandLine(proc.commandLine), roots)) owned += 1;
  }
  return { owned, foreign: processes.length - owned };
}
