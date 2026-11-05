import http from 'node:http';
import type { AddressInfo } from 'node:net';

/** Deterministic content: any range can be generated and compared without holding the whole file. */
export function expectedBytes(start: number, end: number): Buffer {
  const out = Buffer.allocUnsafe(end - start + 1);
  for (let i = 0; i < out.length; i += 1) {
    const at = start + i;
    out[i] = (at * 31 + (at >>> 10) * 7 + (at >>> 20)) & 0xff;
  }
  return out;
}

export interface StubCdn {
  url: string;
  size: number;
  /** Range header of every request, in arrival order. */
  ranges: string[];
  /** Requests whose client went away before the response finished. */
  aborted: number;
  /** Bytes written to clients. */
  sentBytes: number;
  /** Rejects the next ranged request that does not start at offset 0 with this status. */
  failNextMiddle(status: number): void;
  /** Rejects requests whose `gen` query is below this number with 403 (a link that expired). */
  expireLinksBefore(gen: number): void;
  close(): Promise<void>;
}

export interface StubCdnOptions {
  size?: number;
  contentType?: string;
  /** Pause between 64 KB chunks, to keep a response open long enough to abort it. */
  chunkDelayMs?: number;
  /** Answer 200 with the whole body and ignore Range. */
  ignoreRange?: boolean;
}

export async function startStubCdn(options: StubCdnOptions = {}): Promise<StubCdn> {
  const size = options.size ?? 64 * 1024 * 1024;
  let failMiddle: number | null = null;
  let minGen = 0;
  const cdn: StubCdn = {
    url: '',
    size,
    ranges: [],
    aborted: 0,
    sentBytes: 0,
    failNextMiddle: (status) => {
      failMiddle = status;
    },
    expireLinksBefore: (gen) => {
      minGen = gen;
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };

  const server = http.createServer((req, res) => {
    const parsed = new URL(req.url ?? '/', 'http://stub');
    const header = req.headers.range;
    cdn.ranges.push(header ?? '(none)');
    if (Number(parsed.searchParams.get('gen') ?? 0) < minGen) {
      res.writeHead(403).end();
      return;
    }
    const match = header ? /^bytes=(\d*)-(\d*)$/.exec(header) : null;
    let start = 0;
    let end = size - 1;
    if (match && !options.ignoreRange) {
      if (match[1] === '') start = Math.max(0, size - Number(match[2]));
      else {
        start = Number(match[1]);
        if (match[2]) end = Math.min(end, Number(match[2]));
      }
    }
    if (failMiddle !== null && start > 0) {
      const status = failMiddle;
      failMiddle = null;
      res.writeHead(status).end();
      return;
    }
    if (start >= size) {
      res.writeHead(416, { 'Content-Range': `bytes */${size}` }).end();
      return;
    }
    const partial = !!match && !options.ignoreRange;
    res.writeHead(partial ? 206 : 200, {
      'Content-Type': options.contentType ?? 'video/x-matroska',
      'Accept-Ranges': 'bytes',
      'Content-Length': end - start + 1,
      ...(partial ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}),
    });
    let finished = false;
    res.on('finish', () => {
      finished = true;
    });
    res.on('close', () => {
      if (!finished) cdn.aborted += 1;
    });
    let pos = start;
    const step = (): void => {
      if (res.destroyed || pos > end) {
        if (!res.destroyed) res.end();
        return;
      }
      const to = Math.min(end, pos + 65535);
      const chunk = expectedBytes(pos, to);
      cdn.sentBytes += chunk.length;
      pos = to + 1;
      const ok = res.write(chunk);
      const next = (): void => {
        if (options.chunkDelayMs) setTimeout(step, options.chunkDelayMs);
        else setImmediate(step);
      };
      if (ok) next();
      else res.once('drain', next);
    };
    step();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  cdn.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/file`;
  return cdn;
}
