import { ErrorResponseSchema, LogsResponseSchema, type LogsResponse } from '@homestream/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { logEvent, type EventLevel, type EventSource } from '../../src/events/record.js';
import { clearSecrets, registerSecret } from '../../src/redact.js';
import { makeTempDir, removeDir } from '../helpers.js';
import { bootHealthRig, type HealthRig } from './rig.js';

let root: string;
let rig: HealthRig;
let base: string;

beforeAll(async () => {
  root = makeTempDir('health-routes');
  rig = await bootHealthRig(root, { app: { heartbeatMs: 80 } });
  base = await rig.app.listen({ port: 0, host: '127.0.0.1' });
  const deps = { db: rig.app.ctx.db, bus: rig.app.ctx.bus };
  const seed: [EventLevel, EventSource, string][] = [
    ['info', 'server', 'started'],
    ['warn', 'ffmpeg', 'slow encoder'],
    ['error', 'ffmpeg', 'encoder crashed'],
    ['error', 'torbox', 'key rejected'],
    ['warn', 'gateway', 'busy'],
  ];
  for (const [level, source, message] of seed) logEvent(deps, { level, source, message, sessionId: source === 'ffmpeg' ? 'sess-1' : null });
});
afterAll(async () => {
  await rig.close();
  clearSecrets();
  removeDir(root);
});

const logs = async (query = ''): Promise<{ status: number; body: LogsResponse }> => {
  const res = await rig.app.inject(`/api/logs${query}`);
  return { status: res.statusCode, body: res.json() };
};

describe('GET /api/logs', () => {
  it('returns newest-first events with id, ts, level, source, message and optional sessionId', async () => {
    const { status, body } = await logs('?limit=3');
    expect(status).toBe(200);
    expect(LogsResponseSchema.parse(body)).toEqual(body);
    expect(body.events).toHaveLength(3);
    const ids = body.events.map((event) => event.id);
    expect(ids).toEqual([...ids].sort((a, b) => b - a));
    expect(body.events[0]).toMatchObject({ level: 'warn', source: 'gateway', message: 'busy' });
    expect(typeof body.events[0]?.ts).toBe('number');
  });

  it('filters by level, by source and by both', async () => {
    expect((await logs('?level=error')).body.events.map((e) => e.message)).toEqual(['key rejected', 'encoder crashed']);
    expect((await logs('?source=ffmpeg')).body.events.map((e) => e.message)).toEqual(['encoder crashed', 'slow encoder']);
    const both = (await logs('?level=error&source=ffmpeg')).body.events;
    expect(both).toEqual([expect.objectContaining({ message: 'encoder crashed', sessionId: 'sess-1' })]);
    expect((await logs('?level=info&source=torbox')).body.events).toEqual([]);
  });

  it('caps the limit at 1000 and defaults to 100', async () => {
    expect((await logs('?limit=2')).body.events).toHaveLength(2);
    expect((await logs()).body.events.length).toBeGreaterThan(0);
    expect((await logs('?limit=1001')).status).toBe(400);
    expect((await logs('?limit=0')).status).toBe(400);
    expect((await logs('?limit=abc')).status).toBe(400);
  });

  it.each(['?level=fatal', '?level=', '?source=nope', '?level=ERROR'])('rejects %s with 400 and the standard error shape', async (query) => {
    const { status, body } = await logs(query);
    expect(status).toBe(400);
    expect(ErrorResponseSchema.parse(body).error).toMatchObject({ code: 'invalid_request', message: expect.any(String), hint: expect.any(String) });
  });

  it('redacts rows even when the secret was only registered after the row was written', async () => {
    logEvent({ db: rig.app.ctx.db, bus: rig.app.ctx.bus }, { level: 'info', source: 'server', message: 'late-secret-value-777 seen' });
    registerSecret('late-secret-value-777');
    const text = (await rig.app.inject('/api/logs?limit=1000')).body;
    expect(text).not.toContain('late-secret-value-777');
    expect(text).toContain('<redacted>');
  });
});

async function capture(path: string, until: (text: string) => boolean, timeoutMs = 4000): Promise<{ text: string; type: string | null }> {
  const controller = new AbortController();
  const res = await fetch(`${base}${path}`, { signal: controller.signal });
  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  let text = '';
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && !until(text)) {
    const chunk = await Promise.race([reader.read(), new Promise<null>((resolve) => setTimeout(() => resolve(null), deadline - Date.now()))]);
    if (!chunk || chunk.done) break;
    text += decoder.decode(chunk.value, { stream: true });
  }
  controller.abort();
  return { text, type: res.headers.get('content-type') };
}

const eventNames = (text: string): string[] => [...text.matchAll(/^event: (.+)$/gm)].map((match) => match[1] as string);

describe('SSE /api/events', () => {
  it('delivers heartbeat, health (after POST /run), session.* and log events to two clients at once', async () => {
    const wanted = (text: string): boolean => ['heartbeat', 'health', 'session.start', 'session.update', 'session.end', 'log'].every((name) => eventNames(text).includes(name));
    const a = capture('/api/events', wanted);
    const b = capture('/api/events', wanted);
    await new Promise((resolve) => setTimeout(resolve, 150));
    await rig.run();
    rig.app.ctx.bus.emit('session.start', { sessionId: 's1', state: 'starting' });
    rig.app.ctx.bus.emit('session.update', { sessionId: 's1', state: 'playing', positionSec: 4, decision: {}, encoder: { fps: 60, speed: 2.1 } });
    rig.app.ctx.bus.emit('session.end', { sessionId: 's1' });
    logEvent({ db: rig.app.ctx.db, bus: rig.app.ctx.bus }, { level: 'warn', source: 'server', message: 'rejected request' });
    const [first, second] = await Promise.all([a, b]);

    for (const result of [first, second]) {
      expect(result.type).toContain('text/event-stream');
      expect(wanted(result.text)).toBe(true);
    }
    const health = /event: health\ndata: (.+)\n/.exec(first.text)?.[1] as string;
    const snapshot = JSON.parse(health) as { overall: string; checks: { id: string }[] };
    expect(snapshot.checks.map((check) => check.id)).toContain('network');
    expect(first.text).toContain('"encoder":{"fps":60,"speed":2.1}');
    expect(first.text).toMatch(/event: log\ndata: \{"id":\d+,"ts":\d+,"level":"warn","source":"server","message":"rejected request"/);
  });

  it('lets a client reconnect and read the current snapshots after another one left', async () => {
    const gone = await capture('/api/events', (text) => text.includes('event: heartbeat'));
    expect(gone.text).toContain('event: heartbeat');
    const again = await capture('/api/events', (text) => eventNames(text).filter((name) => name === 'heartbeat').length >= 2);
    expect(eventNames(again.text).filter((name) => name === 'heartbeat').length).toBeGreaterThanOrEqual(2);
    expect((await rig.app.inject('/api/health')).statusCode).toBe(200);
    expect((await rig.app.inject('/api/activity')).statusCode).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(rig.app.ctx.bus.listenerCount).toBe(0);
  });
});
