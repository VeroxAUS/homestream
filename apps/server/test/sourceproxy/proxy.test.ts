import http from 'node:http';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createSilentLogger } from '../../src/logger.js';
import type { ProbeResult } from '../../src/playback/probe.js';
import { PREFETCH_OWNER, SourceProxy, type SourceHandle } from '../../src/sourceproxy/proxy.js';
import { STARVED_BYTES_PER_SEC } from '../../src/sourceproxy/serve.js';
import { expectedBytes, startStubCdn, type StubCdn } from './stubCdn.js';

const MB = 1024 * 1024;
const PROBE = { durationSec: 10 } as ProbeResult;

let cdn: StubCdn;
const proxies: SourceProxy[] = [];

beforeAll(async () => {
  cdn = await startStubCdn({ size: 64 * MB });
});

afterAll(async () => {
  await cdn.close();
});

afterEach(async () => {
  await Promise.all(proxies.splice(0).map((proxy) => proxy.close()));
});

interface Rig {
  proxy: SourceProxy;
  resolves: string[];
  probes: string[];
}

function rig(options: Partial<ConstructorParameters<typeof SourceProxy>[0]> = {}, target: () => string = () => cdn.url): Rig {
  const resolves: string[] = [];
  const probes: string[] = [];
  const proxy = new SourceProxy({
    resolveUrl: async (raw) => {
      resolves.push(raw);
      return `${target()}?gen=${resolves.length}`;
    },
    probe: async (url) => {
      probes.push(url);
      return PROBE;
    },
    port: 0,
    logger: createSilentLogger(),
    ...options,
  });
  proxies.push(proxy);
  return { proxy, resolves, probes };
}

async function read(url: string, range?: string): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }> {
  return new Promise((resolve, reject) => {
    http
      .get(url, { headers: range ? { Range: range } : {}, agent: false }, (res) => {
        const parts: Buffer[] = [];
        res.on('data', (chunk: Buffer) => parts.push(chunk));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(parts) }));
        res.on('error', reject);
      })
      .on('error', reject);
  });
}

async function settleHead(handle: SourceHandle): Promise<void> {
  // Head and tail fill front to back, so their last bytes are only served once each region is completely in memory.
  await read(handle.url, `bytes=${16 * MB - 1}-${16 * MB - 1}`);
  await read(handle.url, `bytes=${64 * MB - 1}-`);
}

describe('listening', () => {
  it('binds to loopback only', async () => {
    const { proxy } = rig();
    const port = await proxy.listen();
    expect(port).toBeGreaterThan(0);
    const server = (proxy as unknown as { server: http.Server }).server;
    expect(server.address()).toMatchObject({ address: '127.0.0.1', port });
  });

  it('is gone after close()', async () => {
    const { proxy } = rig();
    const port = await proxy.listen();
    await proxy.close();
    await expect(read(`http://127.0.0.1:${port}/`)).rejects.toThrow();
  });

  it('answers 404 for unknown keys and other paths, and 405 for writes', async () => {
    const { proxy } = rig();
    const port = await proxy.listen();
    expect((await read(`http://127.0.0.1:${port}/src/does-not-exist`)).status).toBe(404);
    expect((await read(`http://127.0.0.1:${port}/`)).status).toBe(404);
    const post = await new Promise<number>((resolve, reject) => {
      const req = http.request(`http://127.0.0.1:${port}/src/does-not-exist`, { method: 'POST' }, (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      });
      req.on('error', reject).end();
    });
    expect(post).toBe(405);
  });

  it('falls back to a free port when the wanted one is taken', async () => {
    const first = rig();
    const taken = await first.proxy.listen();
    const second = rig({ port: taken });
    const port = await second.proxy.listen();
    expect(port).not.toBe(taken);
  });
});

describe('range responses', () => {
  it('serves exact 206 ranges across head, middle and tail, and 200 without Range', async () => {
    const { proxy } = rig();
    const handle = await proxy.acquire('gw://a', 'session-1');
    expect(handle.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/src\/[A-Za-z0-9_-]+$/);
    expect(handle.url).not.toContain('gen=');

    const cases: Array<[string, number, number]> = [
      ['bytes=0-99', 0, 99],
      ['bytes=16777000-16778000', 16_777_000, 16_778_000], // across the head boundary
      ['bytes=30000000-31500000', 30_000_000, 31_500_000], // middle, crossing block boundaries
      ['bytes=67000000-67108863', 67_000_000, 67_108_863], // inside the tail
    ];
    for (const [range, start, end] of cases) {
      const res = await read(handle.url, range);
      expect(res.status, range).toBe(206);
      expect(res.headers['content-range']).toBe(`bytes ${start}-${end}/${64 * MB}`);
      expect(Number(res.headers['content-length'])).toBe(end - start + 1);
      expect(res.headers['accept-ranges']).toBe('bytes');
      expect(res.body.equals(expectedBytes(start, end)), range).toBe(true);
    }

    const suffix = await read(handle.url, 'bytes=-1000');
    expect(suffix.status).toBe(206);
    expect(suffix.body.equals(expectedBytes(64 * MB - 1000, 64 * MB - 1))).toBe(true);

    const open = await read(handle.url, `bytes=${64 * MB - 5}-`);
    expect(open.headers['content-range']).toBe(`bytes ${64 * MB - 5}-${64 * MB - 1}/${64 * MB}`);

    const whole = await read(handle.url);
    expect(whole.status).toBe(200);
    expect(Number(whole.headers['content-length'])).toBe(64 * MB);
    expect(whole.headers['content-range']).toBeUndefined();
  }, 60_000);

  it('answers 416 for a start beyond the end and serves HEAD without a body', async () => {
    const { proxy } = rig();
    const handle = await proxy.acquire('gw://a', 'session-1');
    const beyond = await read(handle.url, `bytes=${64 * MB}-`);
    expect(beyond.status).toBe(416);
    expect(beyond.headers['content-range']).toBe(`bytes */${64 * MB}`);

    const head = await new Promise<{ status: number; length: string | undefined; bytes: number }>((resolve, reject) => {
      const req = http.request(handle.url, { method: 'HEAD', agent: false }, (res) => {
        let bytes = 0;
        res.on('data', (chunk: Buffer) => (bytes += chunk.length));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, length: res.headers['content-length'], bytes }));
      });
      req.on('error', reject).end();
    });
    expect(head).toEqual({ status: 200, length: String(64 * MB), bytes: 0 });
  });

  it('passes the content type of the source on', async () => {
    const { proxy } = rig();
    const handle = await proxy.acquire('gw://a', 'session-1');
    expect((await read(handle.url, 'bytes=0-9')).headers['content-type']).toBe('video/x-matroska');
  });
});

describe('caching', () => {
  it('serves the start of the head while the rest of it is still downloading', async () => {
    const slow = await startStubCdn({ size: 64 * MB, chunkDelayMs: 5 });
    try {
      const { proxy } = rig({}, () => slow.url);
      const handle = await proxy.acquire('gw://progressive', 'session-1');
      const started = performance.now();
      const first = await read(handle.url, 'bytes=0-1023');
      const firstMs = performance.now() - started;
      expect(first.body.equals(expectedBytes(0, 1023))).toBe(true);
      // 16 MB at 64 KB per 5 ms takes over a second.
      expect(firstMs).toBeLessThan(500);

      const whole = await read(handle.url, `bytes=${16 * MB - 4096}-${16 * MB - 1}`);
      expect(whole.body.equals(expectedBytes(16 * MB - 4096, 16 * MB - 1))).toBe(true);
    } finally {
      await slow.close();
    }
  }, 30_000);

  it('warms head and tail on acquire and serves them without more upstream requests', async () => {
    const { proxy } = rig();
    const before = cdn.ranges.length;
    const handle = await proxy.acquire('gw://warm', 'prefetch');
    await settleHead(handle);
    const warm = cdn.ranges.slice(before);
    expect(warm).toHaveLength(2);
    expect(warm.sort()).toEqual([`bytes=-${8 * MB}`, `bytes=0-${16 * MB - 1}`].sort());

    const mark = cdn.ranges.length;
    await read(handle.url, 'bytes=100-5000000');
    await read(handle.url, `bytes=${60 * MB}-${61 * MB}`);
    expect(cdn.ranges.slice(mark)).toEqual([]);
  });

  it('keeps blocks read once and does not fetch the same bytes twice', async () => {
    const { proxy } = rig();
    const handle = await proxy.acquire('gw://blocks', 'session-1');
    await settleHead(handle);

    const first = await read(handle.url, `bytes=${30 * MB}-${34 * MB - 1}`);
    expect(first.body.equals(expectedBytes(30 * MB, 34 * MB - 1))).toBe(true);
    const mark = cdn.ranges.length;
    const sent = cdn.sentBytes;

    // Overlaps the cached 30..34 MB: only the new bytes may come from upstream.
    const second = await read(handle.url, `bytes=${28 * MB}-${36 * MB - 1}`);
    expect(second.body.equals(expectedBytes(28 * MB, 36 * MB - 1))).toBe(true);
    expect(cdn.sentBytes - sent).toBeLessThanOrEqual(4 * MB + 1);
    expect(cdn.ranges.slice(mark)).toHaveLength(2);

    const again = cdn.sentBytes;
    await read(handle.url, `bytes=${28 * MB + 17}-${36 * MB - 5}`);
    expect(cdn.sentBytes).toBe(again);
  }, 60_000);

  it('does not block-cache extractor reads but still serves them from existing blocks', async () => {
    const { proxy } = rig();
    const handle = await proxy.acquire('gw://extract', 'session-1');
    await settleHead(handle);
    const range = `bytes=${40 * MB}-${42 * MB - 1}`;

    const viaExtractor = await read(handle.extractorUrl, range);
    expect(viaExtractor.body.equals(expectedBytes(40 * MB, 42 * MB - 1))).toBe(true);
    const sent = cdn.sentBytes;
    await read(handle.extractorUrl, range);
    expect(cdn.sentBytes - sent).toBeGreaterThanOrEqual(2 * MB);

    await read(handle.url, range);
    const cached = cdn.sentBytes;
    const viaExtractorAgain = await read(handle.extractorUrl, range);
    expect(viaExtractorAgain.body.equals(expectedBytes(40 * MB, 42 * MB - 1))).toBe(true);
    expect(cdn.sentBytes).toBe(cached);
  }, 60_000);

  it('throttles extractor reads from upstream only while the encoder is starved', async () => {
    const { proxy } = rig();
    const handle = await proxy.acquire('gw://starve', 'session-1');
    await settleHead(handle);
    const length = 2 * MB;

    handle.setEncoderStarved(false);
    let started = performance.now();
    await read(handle.extractorUrl, `bytes=${45 * MB}-${45 * MB + length - 1}`);
    const free = performance.now() - started;

    handle.setEncoderStarved(true);
    started = performance.now();
    await read(handle.extractorUrl, `bytes=${50 * MB}-${50 * MB + length - 1}`);
    const slow = performance.now() - started;

    expect(slow).toBeGreaterThanOrEqual((length / STARVED_BYTES_PER_SEC) * 1000 * 0.8);
    expect(slow).toBeGreaterThan(free * 2);

    handle.setEncoderStarved(true);
    started = performance.now();
    await read(handle.url, `bytes=${55 * MB}-${55 * MB + length - 1}`);
    expect(performance.now() - started).toBeLessThan((length / STARVED_BYTES_PER_SEC) * 1000 * 0.8);
  }, 60_000);

  it('destroys the upstream request when the client disconnects', async () => {
    const slow = await startStubCdn({ size: 64 * MB, chunkDelayMs: 5 });
    try {
      const { proxy } = rig({}, () => slow.url);
      const handle = await proxy.acquire('gw://abort', 'session-1');
      await settleHead(handle);
      const before = slow.aborted;
      await new Promise<void>((resolve) => {
        const req = http.get(handle.url, { headers: { Range: `bytes=${20 * MB}-` }, agent: false }, (res) => {
          res.once('data', () => {
            req.destroy();
            resolve();
          });
        });
        req.on('error', () => undefined);
      });
      await expect.poll(() => slow.aborted, { timeout: 5_000 }).toBeGreaterThan(before);
    } finally {
      await slow.close();
    }
  }, 30_000);
});

describe('expired links', () => {
  it('re-resolves inside the proxy and the reader never notices', async () => {
    const { proxy, resolves } = rig();
    const handle = await proxy.acquire('gw://expire', 'session-1');
    await settleHead(handle);
    expect(resolves).toHaveLength(1);

    cdn.expireLinksBefore(2);
    try {
      const res = await read(handle.url, `bytes=${25 * MB}-${26 * MB - 1}`);
      expect(res.status).toBe(206);
      expect(res.body.equals(expectedBytes(25 * MB, 26 * MB - 1))).toBe(true);
      expect(resolves).toHaveLength(2);
      expect(proxy.stats().linkRefreshes).toBe(1);
    } finally {
      cdn.expireLinksBefore(0);
    }
  }, 30_000);

  it('survives a single failed range request with a 403 in the middle of a stream', async () => {
    const { proxy, resolves } = rig();
    const handle = await proxy.acquire('gw://403', 'session-1');
    await settleHead(handle);
    cdn.failNextMiddle(403);
    const res = await read(handle.url, `bytes=${33 * MB}-${35 * MB - 1}`);
    expect(res.body.equals(expectedBytes(33 * MB, 35 * MB - 1))).toBe(true);
    expect(resolves).toHaveLength(2);
  }, 30_000);

  it('retries a transient 503 without re-resolving the link', async () => {
    const { proxy, resolves } = rig();
    const handle = await proxy.acquire('gw://503', 'session-1');
    await settleHead(handle);
    cdn.failNextMiddle(503);
    const res = await read(handle.url, `bytes=${37 * MB}-${38 * MB - 1}`);
    expect(res.body.equals(expectedBytes(37 * MB, 38 * MB - 1))).toBe(true);
    expect(resolves).toHaveLength(1);
  }, 30_000);

  it('fails the acquire with a redacted stream_unavailable error when the source cannot be opened', async () => {
    const dead = await startStubCdn({ size: 1 * MB });
    await dead.close();
    const { proxy } = rig({}, () => dead.url);
    const error = await proxy.acquire('gw://dead', 'session-1').catch((e: unknown) => e as { code: string; message: string });
    expect(error).toMatchObject({ code: 'stream_unavailable' });
    expect(JSON.stringify(error)).not.toContain('127.0.0.1');
    expect(proxy.stats().sources).toBe(0);
  }, 30_000);
});

describe('lifetime', () => {
  it('shares one entry per gateway link and one probe, and drops it with the last owner', async () => {
    const { proxy, resolves, probes } = rig();
    const [a, b] = await Promise.all([proxy.acquire('gw://shared', 'prefetch'), proxy.acquire('gw://shared', 'session-1')]);
    expect(a.url).toBe(b.url);
    expect(resolves).toHaveLength(1);

    await Promise.all([a.probe(), b.probe()]);
    await b.probe();
    expect(probes).toEqual([a.url]);

    b.release();
    expect((await read(a.url, 'bytes=0-9')).status).toBe(206);
    a.release();
    expect((await read(a.url, 'bytes=0-9')).status).toBe(404);
    expect(proxy.stats().sources).toBe(0);
    expect(proxy.stats().cache.bytes).toBe(0);
  });

  it('does not cache a failed probe', async () => {
    let calls = 0;
    const { proxy } = rig({
      probe: async () => {
        calls += 1;
        if (calls === 1) throw new Error('boom');
        return PROBE;
      },
    });
    const handle = await proxy.acquire('gw://probe', 'session-1');
    await expect(handle.probe()).rejects.toThrow('boom');
    await expect(handle.probe()).resolves.toBe(PROBE);
    await handle.probe();
    expect(calls).toBe(2);
  });

  it('expires prefetch-only entries after their idle time, keeps played ones', async () => {
    const { proxy } = rig({ prefetchTtlMs: 150, sweepIntervalMs: 30 });
    const idle = await proxy.acquire('gw://idle', PREFETCH_OWNER);
    const playing = await proxy.acquire('gw://playing', PREFETCH_OWNER);
    await proxy.acquire('gw://playing', 'session-1');
    await expect.poll(async () => (await read(idle.url, 'bytes=0-0')).status, { timeout: 5_000, interval: 200 }).toBe(404);
    expect((await read(playing.url, 'bytes=0-0')).status).toBe(206);
  });

  it('keeps at most a few prefetch-only entries, dropping the oldest', async () => {
    const { proxy } = rig({ maxPrefetchEntries: 2 });
    const first = await proxy.acquire('gw://p1', PREFETCH_OWNER);
    await proxy.acquire('gw://p2', PREFETCH_OWNER);
    await proxy.acquire('gw://p3', PREFETCH_OWNER);
    expect(proxy.stats().sources).toBe(2);
    expect((await read(first.url, 'bytes=0-0')).status).toBe(404);
  });

  it('refuses new sources once closed', async () => {
    const { proxy } = rig();
    await proxy.acquire('gw://x', 'session-1');
    await proxy.close();
    await expect(proxy.acquire('gw://y', 'session-1')).rejects.toMatchObject({ code: 'shutting_down' });
  });
});

describe('local files', () => {
  it('serves plain file paths so local sources go through the same loopback URL', async () => {
    const { writeFileSync } = await import('node:fs');
    const path = await import('node:path');
    const { makeTempDir, removeDir } = await import('../helpers.js');
    const dir = makeTempDir('proxy-file');
    try {
      const file = path.join(dir, 'local.bin');
      writeFileSync(file, expectedBytes(0, 3 * MB - 1));
      const { proxy } = rig({ resolveUrl: async () => file });
      const handle = await proxy.acquire('gw://local', 'session-1');
      const res = await read(handle.url, `bytes=${MB}-${MB + 99}`);
      expect(res.status).toBe(206);
      expect(res.headers['content-range']).toBe(`bytes ${MB}-${MB + 99}/${3 * MB}`);
      expect(res.body.equals(expectedBytes(MB, MB + 99))).toBe(true);
      expect((await read(handle.url)).body.equals(expectedBytes(0, 3 * MB - 1))).toBe(true);
      handle.release();
    } finally {
      removeDir(dir);
    }
  });
});
