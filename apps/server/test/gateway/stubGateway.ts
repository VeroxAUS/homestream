import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { CACHED_NAME, UNCACHED_NAME } from '../streams/fixtures.js';

export interface StubStream {
  name?: string;
  url?: string;
  description?: string;
  behaviorHints?: { filename?: string; videoSize?: number };
}

export interface StubResponse {
  status?: number;
  body?: unknown;
  /** Raw body, sent instead of JSON-encoding `body`. */
  raw?: string;
}

export interface StubGateway {
  manifestUrl: string;
  /** Every request path (without the secret prefix), in arrival order. */
  paths: string[];
  /** Arrival times in ms (performance.now clock). */
  arrivals: number[];
  setDelay(ms: number): void;
  setRespond(fn: (path: string) => StubResponse): void;
  close(): Promise<void>;
}

const PREFIX = '/stremio/stubsecret1/stubsecret2';

export function stubStream(index: number, filename: string, options: { cached: boolean; size?: number }): StubStream {
  return {
    name: options.cached ? CACHED_NAME : UNCACHED_NAME,
    description: 'ignored',
    url: `https://cdn.example.test/playback/token${index}/${encodeURIComponent(filename)}`,
    behaviorHints: { filename, videoSize: options.size ?? 1_000_000_000 + index },
  };
}

export async function startStubGateway(
  respond: (path: string) => StubResponse,
  delayMs = 0,
  host = '127.0.0.1',
): Promise<StubGateway> {
  let currentRespond = respond;
  let currentDelay = delayMs;
  const paths: string[] = [];
  const arrivals: number[] = [];

  const server = http.createServer((req, res) => {
    const url = (req.url ?? '').replace(PREFIX, '');
    paths.push(url);
    arrivals.push(performance.now());
    const answer = currentRespond(url);
    setTimeout(() => {
      res.writeHead(answer.status ?? 200, { 'content-type': 'application/json' });
      res.end(answer.raw ?? JSON.stringify(answer.body ?? { streams: [] }));
    }, currentDelay);
  });
  await new Promise<void>((resolve) => server.listen(0, host, resolve));
  const { port } = server.address() as AddressInfo;

  return {
    manifestUrl: `http://${host}:${port}${PREFIX}/manifest.json`,
    paths,
    arrivals,
    setDelay: (ms) => {
      currentDelay = ms;
    },
    setRespond: (fn) => {
      currentRespond = fn;
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

/** Largest number of arrivals inside any sliding window of `windowMs`. */
export function maxArrivalsInWindow(arrivals: number[], windowMs: number): number {
  const sorted = [...arrivals].sort((a, b) => a - b);
  let best = 0;
  for (let i = 0; i < sorted.length; i += 1) {
    let count = 0;
    for (let j = i; j < sorted.length && (sorted[j] as number) - (sorted[i] as number) < windowMs; j += 1) count += 1;
    best = Math.max(best, count);
  }
  return best;
}
