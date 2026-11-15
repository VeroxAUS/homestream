import type { BlockCacheStats } from './blockCache.js';
import type { ReadAheadChange } from './readerHolds.js';

const MIB = 1024 * 1024;
/** Transitions of a healthy window are tens of seconds apart; this only stops a flapping one from filling the log. */
const MIN_INTERVAL_MS = 1000;

export interface MemoryFigures {
  rssMb: number;
  heapUsedMb: number;
  externalMb: number;
  arrayBuffersMb: number;
  cacheMb: number;
  cacheBlocks: number;
}

export function describeMemory(
  usage: Pick<NodeJS.MemoryUsage, 'rss' | 'heapUsed' | 'external' | 'arrayBuffers'>,
  cache: Pick<BlockCacheStats, 'bytes' | 'blocks'>,
): MemoryFigures {
  const mb = (bytes: number): number => Math.round(bytes / MIB);
  return {
    rssMb: mb(usage.rss),
    heapUsedMb: mb(usage.heapUsed),
    externalMb: mb(usage.external),
    arrayBuffersMb: mb(usage.arrayBuffers),
    cacheMb: mb(cache.bytes),
    cacheBlocks: cache.blocks,
  };
}

export interface ReadAheadNotesDeps {
  now?: () => number;
  usage?: () => NodeJS.MemoryUsage;
}

/**
 * Writes one log line when an encoder's read-ahead window closes or reopens, with the memory of this process and the block
 * cache at that moment. A resume is when the encoder suddenly reads again, so the line brackets any memory growth on it.
 */
export function createReadAheadNotes(
  logger: { info(fields: object, message: string): void },
  cache: { stats(): BlockCacheStats },
  deps: ReadAheadNotesDeps = {},
): (change: ReadAheadChange) => void {
  const now = deps.now ?? Date.now;
  const usage = deps.usage ?? process.memoryUsage;
  let last = Number.NEGATIVE_INFINITY;
  return (change) => {
    const at = now();
    if (at - last < MIN_INTERVAL_MS) return;
    last = at;
    logger.info(
      {
        sessionId: change.owner,
        state: change.state,
        leadSec: Math.round(change.leadSec * 10) / 10,
        ...describeMemory(usage(), cache.stats()),
      },
      change.state === 'waiting' ? 'Read-ahead window closed' : 'Read-ahead window reopened',
    );
  };
}
