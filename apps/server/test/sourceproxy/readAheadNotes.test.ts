import { describe, expect, it } from 'vitest';
import type { BlockCacheStats } from '../../src/sourceproxy/blockCache.js';
import { createReadAheadNotes, describeMemory } from '../../src/sourceproxy/readAheadNotes.js';
import { ReaderHolds, type ReadAheadChange } from '../../src/sourceproxy/readerHolds.js';
import { MB, acquireSettled, installRigHooks, rig } from './bandwidthRig.js';

installRigHooks();

function holds(): { holds: ReaderHolds; changes: ReadAheadChange[] } {
  const changes: ReadAheadChange[] = [];
  let token = 0;
  const created = new ReaderHolds(
    176,
    120,
    () => `token-${(token += 1)}`,
    () => undefined,
    (change) => changes.push(change),
  );
  return { holds: created, changes };
}

const STATS: BlockCacheStats = { bytes: 300 * MB, blocks: 300, evictions: 2, hits: 10, misses: 4 };
const USAGE = { rss: 700 * MB, heapTotal: 90 * MB, heapUsed: 60 * MB, external: 340 * MB, arrayBuffers: 320 * MB };

describe('read-ahead transition notes', () => {
  it('ReaderHolds reports each waiting and filling transition once, with the lead that caused it', () => {
    const { holds: readerHolds, changes } = holds();
    readerHolds.setLead('s1', 100);
    readerHolds.setLead('s1', 177);
    readerHolds.setLead('s1', 178);
    readerHolds.setLead('s1', 125);
    readerHolds.setLead('s1', 119);
    expect(changes).toEqual([
      { owner: 's1', state: 'waiting', leadSec: 177 },
      { owner: 's1', state: 'filling', leadSec: 119 },
    ]);
  });

  it('reports a reset out of waiting as a reopening and a reset of an open window as nothing', () => {
    const { holds: readerHolds, changes } = holds();
    readerHolds.reset('s1');
    expect(changes).toEqual([]);
    readerHolds.setLead('s1', 180);
    readerHolds.reset('s1');
    expect(changes.map((change) => change.state)).toEqual(['waiting', 'filling']);
  });

  it('formats rounded process and cache sizes in MiB', () => {
    expect(describeMemory(USAGE, STATS)).toEqual({
      rssMb: 700,
      heapUsedMb: 60,
      externalMb: 340,
      arrayBuffersMb: 320,
      cacheMb: 300,
      cacheBlocks: 300,
    });
  });

  it('logs one line per transition with memory figures and skips transitions closer than the minimum interval', () => {
    const lines: Array<{ fields: Record<string, unknown>; message: string }> = [];
    let now = 1_000;
    const notes = createReadAheadNotes(
      { info: (fields: Record<string, unknown>, message: string) => lines.push({ fields, message }) },
      { stats: () => STATS },
      { now: () => now, usage: () => USAGE },
    );
    notes({ owner: 'session-1', state: 'waiting', leadSec: 177.26 });
    now += 200;
    notes({ owner: 'session-1', state: 'filling', leadSec: 119 });
    now += 1_000;
    notes({ owner: 'session-1', state: 'filling', leadSec: 118 });
    expect(lines.map((line) => line.message)).toEqual(['Read-ahead window closed', 'Read-ahead window reopened']);
    expect(lines[1]?.fields.leadSec).toBe(118);
    expect(lines[0]?.fields).toMatchObject({
      sessionId: 'session-1',
      leadSec: 177.3,
      rssMb: 700,
      arrayBuffersMb: 320,
      cacheMb: 300,
    });
  });

  it('the proxy logs the transitions of a real source with its memory figures', async () => {
    const lines: Array<{ fields: Record<string, unknown>; message: string }> = [];
    const logger = {
      info: (fields: unknown, message?: string) => {
        if (typeof fields === 'object' && fields !== null && message) {
          lines.push({ fields: fields as Record<string, unknown>, message });
        }
      },
      warn: () => undefined,
      debug: () => undefined,
      error: () => undefined,
    };
    const proxy = rig({ logger: logger as never, maxDownloadMbps: 400 });
    const handle = await acquireSettled(proxy, 'gw://notes', 'session-1');
    handle.setLead(180);
    expect(lines.map((line) => line.message)).toEqual(['Read-ahead window closed']);
    expect(lines[0]?.fields).toMatchObject({ sessionId: 'session-1', leadSec: 180 });
    expect(typeof lines[0]?.fields.rssMb).toBe('number');
    expect(typeof lines[0]?.fields.cacheMb).toBe('number');
  }, 30_000);
});
