import path from 'node:path';
import type { Config } from '../../config.js';
import type { DiskProbe } from '../exec.js';
import { GIB, type CheckOutcome } from './types.js';

export const DISK_WARN_FREE_GB = 20;
export const DISK_ERROR_FREE_GB = 5;

export interface DiskCheckDeps {
  config: Pick<Config, 'transcodeDir' | 'dataDir' | 'transcodeMaxGb'>;
  probe: DiskProbe;
  /** Finished-segment bytes of live sessions (the part of TRANSCODE_DIR the cap governs). */
  usage: () => { bytes: number; capBytes: number };
}

interface Volume {
  dir: string;
  drive: string;
  freeGb: number;
  totalGb: number;
}

function round(value: number, digits = 1): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

async function volume(dir: string, probe: DiskProbe): Promise<Volume> {
  const space = await probe(dir);
  return { dir, drive: path.parse(path.resolve(dir)).root.replace(/[\\/]+$/, ''), freeGb: round(space.freeBytes / GIB, 2), totalGb: round(space.totalBytes / GIB) };
}

export async function checkDisk({ config, probe, usage }: DiskCheckDeps): Promise<CheckOutcome> {
  let transcode: Volume;
  let data: Volume;
  try {
    [transcode, data] = await Promise.all([volume(config.transcodeDir, probe), volume(config.dataDir, probe)]);
  } catch (error) {
    return {
      status: 'error',
      message: 'The free disk space could not be read.',
      hint: 'Check that TRANSCODE_DIR and DATA_DIR point to existing drives, then run the check again.',
      details: { error: error instanceof Error ? error.message : 'unreadable' },
    };
  }

  const used = usage();
  const details = {
    transcode,
    data,
    transcodeUsageGb: round(used.bytes / GIB, 2),
    transcodeMaxGb: config.transcodeMaxGb,
    transcodeUsagePct: used.capBytes > 0 ? round((used.bytes / used.capBytes) * 100) : 0,
    thresholds: { warnFreeGb: DISK_WARN_FREE_GB, errorFreeGb: DISK_ERROR_FREE_GB },
  };

  const tight = [transcode, ...(data.drive === transcode.drive ? [] : [data])].sort((a, b) => a.freeGb - b.freeGb)[0] as Volume;
  const summary = `${tight.freeGb} GB free on ${tight.drive}; transcode cache ${details.transcodeUsageGb} of ${config.transcodeMaxGb} GB.`;
  const where = `${tight.drive} (${tight.dir === transcode.dir ? 'TRANSCODE_DIR' : 'DATA_DIR'})`;
  if (tight.freeGb < DISK_ERROR_FREE_GB) {
    return {
      status: 'error',
      message: `Almost no disk space left: ${summary}`,
      hint: `Free up space on ${where}, or move TRANSCODE_DIR / DATA_DIR to a drive with more room. Playback cannot write segments when the drive is full.`,
      details,
    };
  }
  if (tight.freeGb < DISK_WARN_FREE_GB) {
    return {
      status: 'warn',
      message: `Disk space is low: ${summary}`,
      hint: `Free up space on ${where}, or move TRANSCODE_DIR / DATA_DIR to a drive with more room.`,
      details,
    };
  }
  if (used.capBytes > 0 && used.bytes > used.capBytes) {
    return {
      status: 'warn',
      message: `The transcode cache is over its limit: ${summary}`,
      hint: 'Playback parks and trims old segments on its own. If this stays, raise TRANSCODE_MAX_GB or stop a session.',
      details,
    };
  }
  return { status: 'ok', message: summary, details };
}
