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

/** PowerShell that lists every ffmpeg.exe with its command line as JSON (empty output when none runs). */
export const FFMPEG_PROCESS_SCRIPT = `
$ErrorActionPreference = 'Stop'
$found = @(Get-CimInstance Win32_Process -Filter "Name='ffmpeg.exe'" | ForEach-Object { [pscustomobject]@{ pid = $_.ProcessId; commandLine = $_.CommandLine } })
if ($found.Count -gt 0) { ConvertTo-Json -InputObject $found -Compress -Depth 3 }
`;

/**
 * @param {string} stdout JSON produced by FFMPEG_PROCESS_SCRIPT (a bare object, an array or nothing)
 * @returns {Array<{pid: number, commandLine: string | null}>}
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
    }));
}

/**
 * The server's ffmpeg-pids.json. A missing or broken file yields no entries, which only makes the exemption narrower.
 * @param {string} text
 * @returns {Array<{pid: number, sessionId: string, match?: string}>}
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

/**
 * A process is HomeStream's when it is in the PID registry and its command line still carries the recorded marker (a recycled pid
 * does not), or when its command line points into a HomeStream transcode or test directory. A process whose command line cannot be
 * read is never counted as ours, so the utilization check stays in force.
 * @param {Array<{pid: number, commandLine: string | null}>} processes
 * @param {{registry?: Array<{pid: number, sessionId: string, match?: string}>, roots?: string[]}} sources
 */
export function countFfmpeg(processes, { registry = [], roots = ownedRoots() } = {}) {
  const wanted = roots.map(normalise);
  let owned = 0;
  for (const proc of processes) {
    const line = proc.commandLine === null ? null : normalise(proc.commandLine);
    const entry = registry.find((e) => e.pid === proc.pid);
    const registered = line !== null && entry !== undefined && line.includes(normalise(entry.match ?? entry.sessionId));
    if (registered || (line !== null && wanted.some((root) => line.includes(root)))) owned += 1;
  }
  return { owned, foreign: processes.length - owned };
}
