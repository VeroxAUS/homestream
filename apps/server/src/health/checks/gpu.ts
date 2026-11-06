import type { CommandRunner } from '../exec.js';
import { failure, type CheckOutcome } from './types.js';

const GPU_WARN_TEMP_C = 85;
const NVIDIA_SMI_ARGS = [
  '--query-gpu=name,driver_version,utilization.gpu,utilization.encoder,memory.used,memory.total,temperature.gpu',
  '--format=csv,noheader,nounits',
];

export interface GpuReading {
  name: string;
  driverVersion: string;
  gpuUtilizationPct: number | null;
  encoderUtilizationPct: number | null;
  memoryUsedMb: number | null;
  memoryTotalMb: number | null;
  temperatureC: number | null;
}

function numeric(value: string | undefined): number | null {
  const parsed = Number(value);
  return value !== undefined && value.trim() !== '' && Number.isFinite(parsed) ? parsed : null;
}

/** Parses the first line of the nvidia-smi CSV; fields such as `[N/A]` become null. */
export function parseGpuCsv(output: string): GpuReading | null {
  const line = output.split(/\r?\n/).find((row) => row.trim());
  if (!line) return null;
  const cells = line.split(',').map((cell) => cell.trim());
  if (cells.length < 7 || !cells[0]) return null;
  return {
    name: cells[0],
    driverVersion: cells[1] ?? '',
    gpuUtilizationPct: numeric(cells[2]),
    encoderUtilizationPct: numeric(cells[3]),
    memoryUsedMb: numeric(cells[4]),
    memoryTotalMb: numeric(cells[5]),
    temperatureC: numeric(cells[6]),
  };
}

export async function checkGpu(deps: { run: CommandRunner; command?: string }): Promise<CheckOutcome> {
  const result = await deps.run(deps.command ?? 'nvidia-smi', NVIDIA_SMI_ARGS, { timeoutMs: 10_000 });
  const reading = result.failure || result.code !== 0 ? null : parseGpuCsv(result.stdout);
  if (!reading) {
    const missing = result.failure === 'ENOENT';
    return failure(
      missing
        ? 'nvidia-smi was not found, so the GPU cannot be read.'
        : 'The GPU could not be read (nvidia-smi failed).',
      'Install or repair the NVIDIA driver and restart the PC if the driver was just updated. Without the GPU, HomeStream cannot encode video.',
      { available: false },
    );
  }
  const details = { available: true, ...reading };
  const summary = `${reading.name}, ${reading.temperatureC ?? '?'} C, GPU ${reading.gpuUtilizationPct ?? '?'}%, encoder ${reading.encoderUtilizationPct ?? '?'}%`;
  if (reading.temperatureC !== null && reading.temperatureC > GPU_WARN_TEMP_C) {
    return {
      status: 'warn',
      message: `The GPU is hot: ${summary}.`,
      hint: 'Check the PC case airflow and fans and close other GPU-heavy programs; a very hot GPU slows down and can crash.',
      details,
    };
  }
  return { status: 'ok', message: summary, details };
}
