import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { gunzipSync } from 'node:zlib';

interface RecordedRequest {
  method: string;
  path: string;
  body: string;
}

export interface TelemetryStub {
  origin: string;
  /** DSN that points at this stub (Sentry envelopes arrive at /api/1/envelope/). */
  dsn: string;
  requests: RecordedRequest[];
  /** Flag values PostHog's `/flags/` endpoint answers with; `null` answers 500. */
  setFlags(flags: Record<string, boolean | string> | null): void;
  close(): Promise<void>;
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks);
  return (request.headers['content-encoding'] === 'gzip' ? gunzipSync(raw) : raw).toString('utf8');
}

/** A loopback server that records everything the Sentry and PostHog clients send, so no test reaches the real services. */
export async function startTelemetryStub(): Promise<TelemetryStub> {
  const requests: RecordedRequest[] = [];
  let flags: Record<string, boolean | string> | null = {};
  const server: Server = createServer((request, response) => {
    void readBody(request).then((body) => {
      const path = (request.url ?? '').split('?')[0] ?? '';
      requests.push({ method: request.method ?? 'GET', path, body });
      response.setHeader('content-type', 'application/json');
      if (path.endsWith('/flags/') || path.endsWith('/decide/')) {
        if (flags === null) {
          response.statusCode = 500;
          response.end('{}');
          return;
        }
        const flagMap = flags;
        response.end(
          JSON.stringify({
            featureFlags: flagMap,
            featureFlagPayloads: {},
            errorsWhileComputingFlags: false,
            flags: Object.fromEntries(
              Object.entries(flagMap).map(([key, value]) => [
                key,
                {
                  key,
                  enabled: value !== false,
                  variant: typeof value === 'string' ? value : null,
                  reason: { code: 'stub', description: 'stub', condition_index: 0 },
                  metadata: { id: 1, version: 1, description: '', payload: null },
                },
              ]),
            ),
          }),
        );
        return;
      }
      response.end(path.includes('/envelope/') ? '{"id":"stub"}' : '{"status":1}');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const origin = `http://127.0.0.1:${port}`;
  return {
    origin,
    dsn: `http://stubkey@127.0.0.1:${port}/1`,
    requests,
    setFlags: (next) => {
      flags = next;
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

// The tests inspect payloads structurally; typing every field of a Sentry or PostHog body would only add noise.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type LooseJson = Record<string, any>;

export interface SentryEnvelopeItem {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
}

/** Splits a Sentry envelope body (newline-delimited JSON) into its items. */
export function parseEnvelope(body: string): SentryEnvelopeItem[] {
  const lines = body.split('\n').filter(Boolean);
  const items: SentryEnvelopeItem[] = [];
  for (let i = 1; i + 1 < lines.length; i += 2) {
    items.push({
      header: JSON.parse(lines[i] as string) as Record<string, unknown>,
      payload: JSON.parse(lines[i + 1] as string) as Record<string, unknown>,
    });
  }
  return items;
}
