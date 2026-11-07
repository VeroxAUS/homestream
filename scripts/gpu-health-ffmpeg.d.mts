export interface FfmpegProcess {
  pid: number;
  commandLine: string | null;
}

export interface PidRegistryEntry {
  pid: number;
  sessionId: string;
  startedAt?: number;
  match?: string;
}

export const FFMPEG_PROCESS_SCRIPT: string;
export function parseFfmpegProcesses(stdout: string): FfmpegProcess[];
export function parsePidRegistry(text: string): PidRegistryEntry[];
export function readPidRegistries(
  env?: Record<string, string | undefined>,
  readFile?: (file: string, encoding: 'utf8') => string,
): PidRegistryEntry[];
export function ownedRoots(env?: Record<string, string | undefined>): string[];
export function countFfmpeg(
  processes: FfmpegProcess[],
  sources?: { registry?: PidRegistryEntry[]; roots?: string[] },
): { owned: number; foreign: number };
