import { createReadStream } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { BLOCK_SIZE, type BlockCache } from './blockCache.js';
import { RatePacer } from './pacer.js';
import { TAIL_BYTES, type Consumer, type Front, type SourceEntry } from './sourceEntry.js';
import { isAbort, rangeInfo } from './upstream.js';

/** An upstream read stops before the next cached block; looking this far ahead keeps one request per long streak. */
export const MAX_BLOCK_SCAN = 256;
const MAX_STALLS = 3;
/** How long a reader waits for another stream to bring the bytes it needs before it fetches them itself. */
const SHARE_WAIT_MS = 1500;
const SHARE_POLL_MS = 20;

export interface ProxyCounters {
  requests: number;
  servedBytes: number;
  memoryBytes: number;
  upstreamRequests: number;
  upstreamBytes: number;
  linkRefreshes: number;
}

export function newCounters(): ProxyCounters {
  return { requests: 0, servedBytes: 0, memoryBytes: 0, upstreamRequests: 0, upstreamBytes: 0, linkRefreshes: 0 };
}

interface ByteRange {
  start: number;
  end: number;
  partial: boolean;
}

/** Null means unsatisfiable (416). Multi-range and malformed headers fall back to the whole resource. */
function parseRange(header: string | undefined, size: number): ByteRange | null {
  const whole: ByteRange = { start: 0, end: size - 1, partial: false };
  const match = header ? /^bytes=(\d*)-(\d*)$/i.exec(header.trim()) : null;
  if (!match || (match[1] === '' && match[2] === '')) return whole;
  if (match[1] === '') {
    const length = Number(match[2]);
    if (length === 0) return null;
    return { start: Math.max(0, size - length), end: size - 1, partial: true };
  }
  const start = Number(match[1]);
  if (start >= size) return null;
  const end = match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1);
  if (end < start) return whole;
  return { start, end, partial: true };
}

interface Sink {
  readonly closed: boolean;
  write(chunk: Buffer): Promise<void>;
  onClose(listener: () => void): void;
}

function sinkFor(res: ServerResponse): Sink {
  const listeners: Array<() => void> = [];
  let closed = false;
  res.on('close', () => {
    closed = true;
    for (const listener of listeners) listener();
  });
  return {
    get closed() {
      return closed;
    },
    write: (chunk) =>
      new Promise<void>((resolve) => {
        if (closed || res.write(chunk)) {
          resolve();
          return;
        }
        const done = (): void => {
          res.off('drain', done);
          res.off('close', done);
          resolve();
        };
        res.once('drain', done);
        res.once('close', done);
      }),
    onClose: (listener) => {
      if (closed) listener();
      else listeners.push(listener);
    },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Bytes of [pos, end] that are already in memory, or null. */
function fromMemory(entry: SourceEntry, cache: BlockCache, pos: number, end: number): Buffer | null {
  if (entry.head && pos < entry.headFilled) return entry.head.subarray(pos, Math.min(end + 1, entry.headFilled));
  if (entry.tail && pos >= entry.tailStart && pos - entry.tailStart < entry.tailFilled) {
    return entry.tail.subarray(pos - entry.tailStart, Math.min(end + 1 - entry.tailStart, entry.tailFilled));
  }
  const index = Math.floor(pos / BLOCK_SIZE);
  const block = cache.get(entry, index);
  if (!block) return null;
  return block.subarray(pos - index * BLOCK_SIZE, Math.min(end + 1 - index * BLOCK_SIZE, BLOCK_SIZE));
}

/** Last byte an upstream read starting at `pos` may fetch without downloading anything that is cached. */
function upstreamBound(entry: SourceEntry, cache: BlockCache, pos: number, end: number): number {
  let bound = end;
  if (entry.tail && pos < entry.tailStart) bound = Math.min(bound, entry.tailStart - 1);
  const first = Math.floor(pos / BLOCK_SIZE);
  const last = Math.min(Math.floor(bound / BLOCK_SIZE), first + MAX_BLOCK_SCAN);
  for (let block = first + 1; block <= last; block += 1) {
    if (cache.has(entry, block)) return Math.min(bound, block * BLOCK_SIZE - 1);
  }
  return Math.min(bound, (first + MAX_BLOCK_SCAN + 1) * BLOCK_SIZE - 1);
}

class BlockCollector {
  private parts: Buffer[] = [];
  private length = 0;
  private collecting: boolean;

  constructor(
    private position: number,
    private readonly store: (index: number, data: Buffer) => void,
  ) {
    this.collecting = position % BLOCK_SIZE === 0;
  }

  /** Keeps only whole aligned blocks; a read that starts mid-block waits for the next boundary. */
  add(chunk: Buffer): void {
    let offset = 0;
    while (offset < chunk.length) {
      if (!this.collecting) {
        const skip = Math.min(BLOCK_SIZE - (this.position % BLOCK_SIZE), chunk.length - offset);
        this.position += skip;
        offset += skip;
        this.collecting = this.position % BLOCK_SIZE === 0;
        continue;
      }
      const take = Math.min(BLOCK_SIZE - this.length, chunk.length - offset);
      this.parts.push(chunk.subarray(offset, offset + take));
      this.length += take;
      offset += take;
      this.position += take;
      if (this.length === BLOCK_SIZE) {
        this.store(this.position / BLOCK_SIZE - 1, Buffer.concat(this.parts, BLOCK_SIZE));
        this.parts = [];
        this.length = 0;
      }
    }
  }
}

async function pumpFile(entry: SourceEntry, range: ByteRange, sink: Sink, counters: ProxyCounters): Promise<void> {
  const stream = createReadStream(entry.filePath, { start: range.start, end: range.end });
  sink.onClose(() => stream.destroy());
  try {
    for await (const chunk of stream as AsyncIterable<Buffer>) {
      if (sink.closed) break;
      counters.servedBytes += chunk.length;
      await sink.write(chunk);
    }
  } catch (error) {
    if (!sink.closed) throw error;
  } finally {
    stream.destroy();
  }
}

/** Waits for another stream to deliver the bytes at `pos` into memory; false when none is coming or it took too long. */
async function waitForSharedBytes(
  entry: SourceEntry,
  cache: BlockCache,
  pos: number,
  end: number,
  sink: Sink,
): Promise<boolean> {
  const deadline = Date.now() + SHARE_WAIT_MS;
  while (!sink.closed && Date.now() < deadline) {
    if (fromMemory(entry, cache, pos, end)) return true;
    if (!entry.streamApproaching(pos, null)) return false;
    await sleep(SHARE_POLL_MS);
  }
  return false;
}

async function pumpRemote(
  entry: SourceEntry,
  consumer: Consumer,
  runId: number | null,
  cache: BlockCache,
  range: ByteRange,
  sink: Sink,
  counters: ProxyCounters,
): Promise<void> {
  let pos = range.start;
  let stalls = 0;
  const pacer = consumer === 'extractor' ? new RatePacer() : null;
  const tailRegion = Math.max(entry.headTarget, entry.size - TAIL_BYTES);
  const lifetime = new AbortController();
  sink.onClose(() => lifetime.abort());

  while (pos <= range.end && !sink.closed) {
    entry.touch();
    // The reader stays connected and simply gets no more bytes until the window opens again.
    if (entry.isHeld(consumer, runId)) {
      await entry.waitForRelease(lifetime.signal);
      continue;
    }
    if (pos < entry.headTarget) await entry.headHas(pos);
    else if (pos >= tailRegion) await entry.tailHas(pos);
    if (sink.closed) return;

    const cached = fromMemory(entry, cache, pos, range.end);
    if (cached) {
      counters.memoryBytes += cached.length;
      counters.servedBytes += cached.length;
      await sink.write(cached);
      pos += cached.length;
      continue;
    }
    if (entry.streamApproaching(pos, null) && (await waitForSharedBytes(entry, cache, pos, range.end, sink))) continue;
    if (sink.closed) return;

    const bound = upstreamBound(entry, cache, pos, range.end);
    const collector = new BlockCollector(pos, (index, data) => {
      if (!entry.closed) cache.put(entry, index, data);
    });

    let response: IncomingMessage;
    try {
      counters.upstreamRequests += 1;
      response = await entry.open(`bytes=${pos}-${bound}`, lifetime.signal);
    } catch (error) {
      if (sink.closed || isAbort(error)) return;
      throw error;
    }
    if (rangeInfo(response)?.start !== pos) {
      response.destroy();
      throw new Error('upstream ignored the range');
    }

    const before = pos;
    const front: Front = { consumer, begin: pos, pos, end: bound };
    entry.fronts.add(front);
    let failure: unknown = null;
    try {
      for await (const chunk of response as AsyncIterable<Buffer>) {
        if (sink.closed) break;
        const part = chunk.length > bound + 1 - pos ? chunk.subarray(0, bound + 1 - pos) : chunk;
        if (pacer && entry.extractorLimit !== null) {
          const wait = pacer.delayFor(part.length, entry.extractorLimit, Date.now());
          if (wait > 0) await sleep(wait);
        }
        await entry.download(part.length, consumer, lifetime.signal);
        if (sink.closed) break;
        counters.upstreamBytes += part.length;
        counters.servedBytes += part.length;
        collector.add(part);
        await sink.write(part);
        pos += part.length;
        front.pos = pos;
        if (pos > bound || entry.isHeld(consumer, runId)) break;
      }
    } catch (error) {
      if (sink.closed || isAbort(error)) return;
      failure = error;
    } finally {
      entry.fronts.delete(front);
      // Closing the connection when the window is full also drops what the socket buffered, so no more bytes arrive while waiting.
      if (!response.complete) response.destroy();
    }
    if (sink.closed) return;
    // A read that fails after delivering data is simply resumed from where it stopped; only a read that makes no progress counts.
    if (pos > before) stalls = 0;
    else {
      stalls += 1;
      if (stalls >= MAX_STALLS) throw failure ?? new Error('upstream returned no data');
    }
  }
}

export async function serveSource(
  req: IncomingMessage,
  res: ServerResponse,
  entry: SourceEntry,
  consumer: Consumer,
  runId: number | null,
  cache: BlockCache,
  counters: ProxyCounters,
): Promise<void> {
  counters.requests += 1;
  entry.touch();
  const range = parseRange(req.headers.range, entry.size);
  if (!range) {
    res.writeHead(416, { 'Content-Range': `bytes */${entry.size}`, 'Content-Length': 0 }).end();
    return;
  }
  const headers: Record<string, string | number> = {
    'Accept-Ranges': 'bytes',
    'Content-Type': entry.contentType,
    'Content-Length': range.end - range.start + 1,
  };
  if (range.partial) headers['Content-Range'] = `bytes ${range.start}-${range.end}/${entry.size}`;
  res.writeHead(range.partial ? 206 : 200, headers);
  if (req.method === 'HEAD' || entry.size === 0) {
    res.end();
    return;
  }

  const sink = sinkFor(res);
  try {
    if (entry.isLocal) await pumpFile(entry, range, sink, counters);
    else await pumpRemote(entry, consumer, runId, cache, range, sink, counters);
    res.end();
  } catch {
    // The status line is already out; a torn connection is how the reader finds out. Details stay in the counters.
    res.destroy();
  }
}
