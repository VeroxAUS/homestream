#!/usr/bin/env node
// GPU health gate (AGENTS.md "GPU safety"). Usage: node scripts/gpu-health.mjs --since <ISO-8601> [--min-free-gb 4]
// Prints one JSON line. Exit 0 = healthy, 1 = new GPU driver events, temperature above the limit, free RAM below
// the minimum (low_memory), or the state could not be read (a gate that cannot look fails closed).
// With --require-idle it also fails (gpu_busy) when, while no ffmpeg runs, the median of 5 GPU utilization samples (~5 s) is >= 25%
// or at least 2 samples are >= 60%, so a game or other heavy GPU app blocks the step but one transient spike from a desktop app does not.
import { execFile } from 'node:child_process';
import { realpathSync } from 'node:fs';
import os from 'node:os';
import { pathToFileURL } from 'node:url';

export const MAX_TEMP_C = 83;
export const DEFAULT_MIN_FREE_GB = 4;
export const MAX_IDLE_UTIL_PCT = 25;
export const IDLE_SAMPLES = 5;
export const IDLE_SAMPLE_GAP_MS = 1000;
/** A sample at or above this counts as a spike; the GPU is busy when at least IDLE_SPIKE_COUNT samples are spikes. */
export const IDLE_SPIKE_PCT = 60;
export const IDLE_SPIKE_COUNT = 2;
const GIB = 1024 ** 3;

const SMI_FIELDS = ['temperature.gpu', 'utilization.gpu', 'utilization.encoder', 'utilization.decoder', 'memory.used', 'power.draw'];

/** @param {string[]} argv */
export function parseArgs(argv) {
  const index = argv.indexOf('--since');
  const raw = index >= 0 ? argv[index + 1] : undefined;
  if (!raw) throw new Error('missing --since <ISO-8601 time the GPU step started>');
  const sinceMs = Date.parse(raw);
  if (Number.isNaN(sinceMs)) throw new Error(`--since is not a valid date: ${raw}`);

  let minFreeGb = DEFAULT_MIN_FREE_GB;
  const minIndex = argv.indexOf('--min-free-gb');
  if (minIndex >= 0) {
    const rawMin = argv[minIndex + 1];
    minFreeGb = Number(rawMin);
    if (rawMin === undefined || rawMin.trim() === '' || !Number.isFinite(minFreeGb) || minFreeGb < 0) {
      throw new Error(`--min-free-gb is not a valid number of GB: ${rawMin}`);
    }
  }
  return { since: new Date(sinceMs).toISOString(), sinceMs, minFreeGb, requireIdle: argv.includes('--require-idle') };
}

/**
 * Get-WinEvent returns a bare object for one hit and an array for several; with no hit the output is empty.
 * @param {string} stdout JSON produced by the query script
 * @returns {Array<{time: string, log: string, provider: string, id: number, level: string, message: string}>}
 */
export function parseEvents(stdout) {
  const text = stdout.trim();
  if (!text) return [];
  const data = JSON.parse(text);
  const list = Array.isArray(data) ? data : [data];
  return list
    .filter((e) => e && typeof e === 'object')
    .map((e) => ({
      time: String(e.time ?? ''),
      log: String(e.log ?? ''),
      provider: String(e.provider ?? ''),
      id: Number(e.id),
      level: String(e.level ?? ''),
      message: String(e.message ?? '').replace(/\s+/g, ' ').trim(),
    }))
    .sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
}

// WER files LiveKernelEvent reports late (often after a reboot) and names the dump after the real event: WATCHDOG-20260903-0140.dmp (local time).
const DUMP_STAMP = /-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})\.dmp/;

/** @param {ReturnType<typeof parseEvents>} events @param {number} sinceMs */
export function filterNewer(events, sinceMs) {
  return events.filter((e) => {
    if (!(Date.parse(e.time) > sinceMs)) return false;
    const stamp = e.provider === 'Windows Error Reporting' ? DUMP_STAMP.exec(e.message) : null;
    if (!stamp) return true;
    const [, y, mo, d, h, mi] = stamp.map(Number);
    return new Date(y, mo - 1, d, h, mi).getTime() > sinceMs;
  });
}

const num = (value) => {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : null;
};

/**
 * Parses `nvidia-smi --query-gpu=<SMI_FIELDS> --format=csv,noheader` (values carry units: "27 %", "2341 MiB", "45.34 W").
 * Several GPUs yield several lines; the hottest reading wins for the temperature, the first line gives the rest.
 */
export function parseNvidiaSmi(stdout) {
  const rows = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split(',').map((cell) => cell.trim()));
  if (rows.length === 0 || rows.some((r) => r.length !== SMI_FIELDS.length)) {
    throw new Error(`unexpected nvidia-smi output: ${stdout.trim().slice(0, 200)}`);
  }
  const [first] = rows;
  const temps = rows.map((r) => num(r[0])).filter((t) => t !== null);
  return {
    tempC: temps.length ? Math.max(...temps) : null,
    utilGpuPct: num(first[1]),
    utilEncoderPct: num(first[2]),
    utilDecoderPct: num(first[3]),
    memUsedMiB: num(first[4]),
    powerW: num(first[5]),
  };
}

/**
 * Free physical RAM (what is available without paging) as the gate sees it.
 * @param {number} freeBytes
 */
export function readMemory(freeBytes = os.freemem()) {
  return { freeGb: Math.round((freeBytes / GIB) * 100) / 100, totalGb: Math.round((os.totalmem() / GIB) * 100) / 100 };
}

/**
 * Parses the JSON of the info-only query: pagefile usage and the D: disk queue length. Either part may be missing.
 * @param {string} stdout
 */
export function parseSystemInfo(stdout) {
  const text = stdout.trim();
  if (!text) return { pagefile: [], diskQueueD: null };
  const data = JSON.parse(text);
  const pageList = Array.isArray(data.pagefile) ? data.pagefile : data.pagefile ? [data.pagefile] : [];
  return {
    pagefile: pageList
      .filter((p) => p && typeof p === 'object')
      .map((p) => ({ name: String(p.name ?? ''), usedMiB: num(p.usedMiB), sizeMiB: num(p.sizeMiB) })),
    diskQueueD: num(data.diskQueueD),
  };
}

/**
 * Process names from the plain `nvidia-smi` table (the query interface lists no WDDM graphics apps, and games are "C+G").
 * nvidia-smi truncates paths ("...cord\app-1.0.9267\Discord.exe"), so only the file name is kept.
 * @param {string} stdout
 */
export function parseGpuProcessNames(stdout) {
  const names = new Set();
  for (const line of stdout.split(/\r?\n/)) {
    const row = /^\|\s+\d+\s+\S+\s+\S+\s+\d+\s+(?:C\+G|C|G)\s+(.+?)\s+(?:N\/A|\d+\s*MiB)\s*\|$/.exec(line.trim());
    if (!row) continue;
    const name = row[1].split(/[\\/]/).pop().replace(/^\.+/, '').trim();
    if (name) names.add(name);
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

/** True when `tasklist /FO CSV /NH` lists at least one ffmpeg.exe ("INFO: No tasks ..." means none). @param {string} stdout */
export function parseFfmpegRunning(stdout) {
  return stdout.split(/\r?\n/).some((line) => /^"ffmpeg\.exe"/i.test(line.trim()));
}

/**
 * `utilPct` is the median of the samples, so one short spike from a desktop app (Discord, Edge) does not count, while
 * sustained load does. `spikes` counts samples at or above IDLE_SPIKE_PCT, which catches bursty load whose median stays low.
 * A missing sample makes the result unknown (null) so the gate fails closed.
 * @param {Array<number | null>} samples
 */
export function summarizeIdle(samples) {
  const valid = samples.filter((s) => typeof s === 'number' && Number.isFinite(s));
  if (valid.length !== samples.length || valid.length === 0) return { samples, utilPct: null, spikes: null };
  const sorted = [...valid].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  const utilPct = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return { samples, utilPct, spikes: valid.filter((s) => s >= IDLE_SPIKE_PCT).length };
}

/** PowerShell for the info-only readings; a failure here never fails the gate. */
export const SYSTEM_INFO_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
$pf = @(Get-CimInstance Win32_PageFileUsage | ForEach-Object { [pscustomobject]@{ name = $_.Name; usedMiB = $_.CurrentUsage; sizeMiB = $_.AllocatedBaseSize } })
$q = Get-Counter '\\PhysicalDisk(*)\\Current Disk Queue Length' | Select-Object -ExpandProperty CounterSamples | Where-Object { $_.InstanceName -match ' D:$' } | Select-Object -First 1
[pscustomobject]@{ pagefile = $pf; diskQueueD = if ($q) { $q.CookedValue } else { $null } } | ConvertTo-Json -Compress -Depth 3
`;

/**
 * @param {{events: object[], gpu: {tempC: number | null} | null, memory?: {freeGb: number} | null, minFreeGb?: number, idle?: {ffmpegRunning: boolean | null, utilPct: number | null, spikes?: number | null, processes: string[]}, errors: string[]}} input
 */
export function evaluate({ events, gpu, memory, minFreeGb = DEFAULT_MIN_FREE_GB, idle, errors }) {
  const reasons = [];
  if (events.length > 0) reasons.push(`${events.length} new GPU driver/TDR event(s)`);
  if (gpu && gpu.tempC !== null && gpu.tempC > MAX_TEMP_C) reasons.push(`temperature ${gpu.tempC} C is above ${MAX_TEMP_C} C`);
  if (!memory || !Number.isFinite(memory.freeGb)) reasons.push('could not check: free RAM is unknown');
  else if (memory.freeGb < minFreeGb) reasons.push(`low_memory: ${memory.freeGb} GB of RAM free, below the ${minFreeGb} GB minimum`);
  if (idle) {
    if (idle.ffmpegRunning === null) reasons.push('could not check: ffmpeg process list is unknown');
    else if (!idle.ffmpegRunning) {
      if (idle.utilPct === null) reasons.push('could not check: GPU utilization is unknown');
      else {
        const apps = idle.processes.length ? ` (GPU processes: ${idle.processes.join(', ')})` : '';
        if (idle.utilPct >= MAX_IDLE_UTIL_PCT) {
          reasons.push(`gpu_busy: median GPU utilization ${idle.utilPct}% is at or above ${MAX_IDLE_UTIL_PCT}% with no ffmpeg running${apps}`);
        } else if ((idle.spikes ?? 0) >= IDLE_SPIKE_COUNT) {
          reasons.push(`gpu_busy: ${idle.spikes} GPU samples at or above ${IDLE_SPIKE_PCT}% with no ffmpeg running${apps}`);
        }
      }
    }
  }
  for (const error of errors) reasons.push(`could not check: ${error}`);
  return { ok: reasons.length === 0, reasons };
}

/**
 * PowerShell that lists the GPU-related events newer than `sinceMs` as a JSON array:
 * nvlddmkm and Display (TDR, Id 4101) from the System log, plus Windows Error Reporting LiveKernelEvent reports
 * from the Application log. "No events found" is not an error; anything else is.
 */
export function buildQueryScript(sinceMs) {
  return `
$ErrorActionPreference = 'Stop'
$start = [DateTimeOffset]::FromUnixTimeMilliseconds(${Math.trunc(sinceMs)}).LocalDateTime
$queries = @(
  @{ LogName = 'System'; ProviderName = 'nvlddmkm'; StartTime = $start },
  @{ LogName = 'System'; ProviderName = 'Display'; StartTime = $start },
  @{ LogName = 'Application'; ProviderName = 'Windows Error Reporting'; StartTime = $start }
)
$found = @()
foreach ($q in $queries) {
  try { $found += Get-WinEvent -FilterHashtable $q }
  catch { if ($_.FullyQualifiedErrorId -notlike 'NoMatchingEventsFound*') { throw } }
}
$found = $found | Where-Object {
  switch ($_.ProviderName) {
    'Windows Error Reporting' { $_.Message -match 'LiveKernelEvent' }
    'Display' { $_.Id -eq 4101 -or ($null -ne $_.Level -and $_.Level -le 3) }
    default { $true }
  }
}
$out = @($found | ForEach-Object {
  [pscustomobject]@{
    time = $_.TimeCreated.ToUniversalTime().ToString('o')
    log = $_.LogName
    provider = $_.ProviderName
    id = $_.Id
    level = $_.LevelDisplayName
    message = if ($_.Message) { $_.Message } else { ($_.Properties | Select-Object -First 2 | ForEach-Object { $_.Value }) -join ' | ' }
  }
})
if ($out.Count -eq 0) { '[]' } else { ConvertTo-Json -InputObject $out -Compress -Depth 3 }
`;
}

function exec(command, args, timeout = 30_000) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout, windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) reject(new Error(`${command} failed: ${(stderr || error.message).trim().slice(0, 300)}`));
      else resolve(stdout);
    });
  });
}

async function readEvents(sinceMs) {
  const encoded = Buffer.from(buildQueryScript(sinceMs), 'utf16le').toString('base64');
  const stdout = await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded]);
  return filterNewer(parseEvents(stdout), sinceMs);
}

async function readGpu() {
  return parseNvidiaSmi(await exec('nvidia-smi', [`--query-gpu=${SMI_FIELDS.join(',')}`, '--format=csv,noheader'], 15_000));
}

async function readSystemInfo() {
  const encoded = Buffer.from(SYSTEM_INFO_SCRIPT, 'utf16le').toString('base64');
  return parseSystemInfo(await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], 20_000));
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Samples overall GPU utilisation IDLE_SAMPLES times and lists the GPU process names and whether an ffmpeg is running. */
async function readIdle() {
  const [ffmpegResult, processResult] = await Promise.allSettled([
    exec('tasklist', ['/FI', 'IMAGENAME eq ffmpeg.exe', '/FO', 'CSV', '/NH'], 15_000),
    exec('nvidia-smi', [], 15_000),
  ]);
  const samples = [];
  for (let i = 0; i < IDLE_SAMPLES; i += 1) {
    if (i > 0) await sleep(IDLE_SAMPLE_GAP_MS);
    try {
      samples.push(parseNvidiaSmi(await exec('nvidia-smi', [`--query-gpu=${SMI_FIELDS.join(',')}`, '--format=csv,noheader'], 15_000)).utilGpuPct);
    } catch {
      samples.push(null);
    }
  }
  return {
    ffmpegRunning: ffmpegResult.status === 'fulfilled' ? parseFfmpegRunning(ffmpegResult.value) : null,
    processes: processResult.status === 'fulfilled' ? parseGpuProcessNames(processResult.value) : [],
    ...summarizeIdle(samples),
  };
}

export async function main(argv) {
  const { since, sinceMs, minFreeGb, requireIdle } = parseArgs(argv);
  const errors = [];
  const [eventsResult, gpuResult, infoResult, idleResult] = await Promise.allSettled([
    readEvents(sinceMs),
    readGpu(),
    readSystemInfo(),
    requireIdle ? readIdle() : Promise.resolve(undefined),
  ]);
  const idle = requireIdle
    ? idleResult.status === 'fulfilled'
      ? idleResult.value
      : { ffmpegRunning: null, utilPct: null, spikes: null, samples: [], processes: [] }
    : undefined;
  if (eventsResult.status === 'rejected') errors.push(`event log: ${eventsResult.reason.message}`);
  if (gpuResult.status === 'rejected') errors.push(`nvidia-smi: ${gpuResult.reason.message}`);
  const events = eventsResult.status === 'fulfilled' ? eventsResult.value : [];
  const gpu = gpuResult.status === 'fulfilled' ? gpuResult.value : null;
  let memory = null;
  try {
    memory = readMemory();
  } catch (error) {
    errors.push(`memory: ${error.message}`);
  }
  const system = infoResult.status === 'fulfilled' ? infoResult.value : null;
  const { ok, reasons } = evaluate({ events, gpu, memory, minFreeGb, idle, errors });
  const shown = events.map((e) => ({ ...e, message: e.message.slice(0, 600) }));
  console.log(
    JSON.stringify({ ok, since, checkedAt: new Date().toISOString(), eventCount: events.length, events: shown, gpu, memory, minFreeGb, idle, system, reasons }),
  );
  return ok ? 0 : 1;
}

// Node resolves a junction in the main module's path, so argv[1] is compared by its real path; a mismatch would skip the gate silently.
function isMainModule() {
  if (!process.argv[1]) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
}

if (isMainModule()) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
      console.log(JSON.stringify({ ok: false, reasons: [error.message] }));
      process.exit(1);
    },
  );
}
