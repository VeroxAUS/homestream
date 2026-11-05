#!/usr/bin/env node
// GPU health gate (AGENTS.md "GPU safety"). Usage: node scripts/gpu-health.mjs --since <ISO-8601>
// Prints one JSON line. Exit 0 = healthy, 1 = new GPU driver events, temperature above the limit,
// or the state could not be read (a gate that cannot look fails closed).
import { execFile } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const MAX_TEMP_C = 83;

const SMI_FIELDS = ['temperature.gpu', 'utilization.gpu', 'utilization.encoder', 'utilization.decoder', 'memory.used', 'power.draw'];

/** @param {string[]} argv */
export function parseArgs(argv) {
  const index = argv.indexOf('--since');
  const raw = index >= 0 ? argv[index + 1] : undefined;
  if (!raw) throw new Error('missing --since <ISO-8601 time the GPU step started>');
  const sinceMs = Date.parse(raw);
  if (Number.isNaN(sinceMs)) throw new Error(`--since is not a valid date: ${raw}`);
  return { since: new Date(sinceMs).toISOString(), sinceMs };
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

/** @param {{events: object[], gpu: {tempC: number | null} | null, errors: string[]}} input */
export function evaluate({ events, gpu, errors }) {
  const reasons = [];
  if (events.length > 0) reasons.push(`${events.length} new GPU driver/TDR event(s)`);
  if (gpu && gpu.tempC !== null && gpu.tempC > MAX_TEMP_C) reasons.push(`temperature ${gpu.tempC} C is above ${MAX_TEMP_C} C`);
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

export async function main(argv) {
  const { since, sinceMs } = parseArgs(argv);
  const errors = [];
  const [eventsResult, gpuResult] = await Promise.allSettled([readEvents(sinceMs), readGpu()]);
  if (eventsResult.status === 'rejected') errors.push(`event log: ${eventsResult.reason.message}`);
  if (gpuResult.status === 'rejected') errors.push(`nvidia-smi: ${gpuResult.reason.message}`);
  const events = eventsResult.status === 'fulfilled' ? eventsResult.value : [];
  const gpu = gpuResult.status === 'fulfilled' ? gpuResult.value : null;
  const { ok, reasons } = evaluate({ events, gpu, errors });
  const shown = events.map((e) => ({ ...e, message: e.message.slice(0, 600) }));
  console.log(JSON.stringify({ ok, since, checkedAt: new Date().toISOString(), eventCount: events.length, events: shown, gpu, reasons }));
  return ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
      console.log(JSON.stringify({ ok: false, reasons: [error.message] }));
      process.exit(1);
    },
  );
}
