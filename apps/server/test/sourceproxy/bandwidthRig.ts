import http from 'node:http';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { createSilentLogger } from '../../src/logger.js';
import type { ProbeResult } from '../../src/playback/probe.js';
import { SourceProxy, type SourceHandle } from '../../src/sourceproxy/proxy.js';
import { expectedBytes, startStubCdn, type StubCdn } from './stubCdn.js';

export const MB = 1024 * 1024;
const PROBE = { durationSec: 10 } as ProbeResult;

const state: { cdn: StubCdn | null } = { cdn: null };
const proxies: SourceProxy[] = [];
const readers: Reader[] = [];

/** The stub CDN of the running test file (400 MB of deterministic bytes); live view of its counters. */
export const cdn = new Proxy({} as StubCdn, {
  get: (_target, key) => (state.cdn as unknown as Record<string | symbol, unknown>)[key],
});

/** Starts the stub CDN once per test file and tears proxies and readers down after every test. */
export function installRigHooks(): void {
  beforeAll(async () => {
    state.cdn = await startStubCdn({ size: 400 * MB });
  });
  afterAll(async () => {
    await state.cdn?.close();
  });
  afterEach(async () => {
    for (const reader of readers.splice(0)) reader.stop();
    await Promise.all(proxies.splice(0).map((proxy) => proxy.close()));
  });
}

export function rig(options: Partial<ConstructorParameters<typeof SourceProxy>[0]> = {}): SourceProxy {
  const proxy = new SourceProxy({
    resolveUrl: async () => (state.cdn as StubCdn).url,
    probe: async () => PROBE,
    port: 0,
    logger: createSilentLogger(),
    ...options,
  });
  proxies.push(proxy);
  return proxy;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** A client that reads a range as fast as the proxy delivers it and counts what it received. */
export class Reader {
  received = 0;
  status = 0;
  ended = false;
  failed = false;
  closed = false;
  readonly chunks: Buffer[] = [];
  private req: http.ClientRequest;

  constructor(
    url: string,
    private readonly start: number,
    end: number | '',
    keep = false,
  ) {
    this.req = http.get(url, { headers: { Range: `bytes=${start}-${end}` }, agent: false }, (res) => {
      this.status = res.statusCode ?? 0;
      res.on('data', (chunk: Buffer) => {
        this.received += chunk.length;
        if (keep) this.chunks.push(chunk);
      });
      res.on('end', () => {
        this.ended = true;
      });
      res.on('error', () => {
        this.failed = true;
      });
      res.on('close', () => {
        this.closed = true;
      });
    });
    this.req.on('error', () => {
      if (!this.closed) this.failed = true;
    });
    readers.push(this);
  }

  stop(): void {
    this.req.destroy();
  }

  matches(): boolean {
    const data = Buffer.concat(this.chunks);
    return data.equals(expectedBytes(this.start, this.start + data.length - 1));
  }
}

export async function acquireSettled(proxy: SourceProxy, url: string, owner = 'session-1'): Promise<SourceHandle> {
  const handle = await proxy.acquire(url, owner);
  // Head and tail are downloaded in the background; their last bytes are only served once both are complete.
  for (const [start, end] of [[16 * MB - 1, 16 * MB - 1] as const, [400 * MB - 1, ''] as const]) {
    const reader = new Reader(handle.url, start, end);
    while (!reader.ended) await sleep(20);
  }
  return handle;
}
