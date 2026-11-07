import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSilentLogger } from '../../src/logger.js';
import type { ProbeResult } from '../../src/playback/probe.js';
import { SourceProxy } from '../../src/sourceproxy/proxy.js';

let server: http.Server;
let base: string;
let requested: string[];
let proxy: SourceProxy;
let resolves: string[];

const LOCATIONS: Record<string, string> = {
  '/two-hop': '/mid',
  '/mid': '/static/downloading.mp4?sig=abc',
  '/to-other-host': 'http://cdn.example.test/static/downloading.mp4',
  '/to-limit': '/static/store_limit_exceeded.mp4',
};

beforeEach(async () => {
  requested = [];
  resolves = [];
  server = http.createServer((req, res) => {
    requested.push(req.url ?? '');
    const location = LOCATIONS[req.url ?? ''];
    if (location) {
      res.writeHead(302, { location }).end();
      return;
    }
    res.writeHead(206, { 'content-range': 'bytes 0-0/4', 'content-length': '1' }).end('x');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  proxy = new SourceProxy({
    resolveUrl: async (raw) => {
      resolves.push(raw);
      throw new Error('the reused target must not be resolved again');
    },
    probe: async () => ({ durationSec: 10 }) as ProbeResult,
    port: 0,
    logger: createSilentLogger(),
  });
});

afterEach(async () => {
  await proxy.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

describe('a reused playback target that leads to a placeholder clip', () => {
  it.each([
    ['a two-hop chain ending at /static/downloading.mp4', '/two-hop', 'stream_not_cached', 409],
    ['an absolute redirect to another host', '/to-other-host', 'stream_not_cached', 409],
    ['the store limit clip', '/to-limit', 'torbox_slots_full', 409],
  ])('is refused for %s and the clip is never requested', async (_label, entry, code, status) => {
    await proxy.listen();
    await expect(proxy.acquire('https://gw.example.test/raw', 'owner', `${base}${entry}`)).rejects.toMatchObject({
      code,
      statusCode: status,
      hint: expect.any(String),
    });
    expect(requested.some((url) => url.startsWith('/static/'))).toBe(false);
    expect(resolves).toEqual([]);
  });

  it('opens a target that is a plain file', async () => {
    await proxy.listen();
    const handle = await proxy.acquire('https://gw.example.test/raw', 'owner', `${base}/file.mkv`);
    expect(handle.sizeBytes).toBe(4);
    handle.release();
  });
});
