import { describe, expect, it } from 'vitest';
import { TorboxClient, TorboxError, parseMylist } from '../../src/downloads/torbox.js';

const KEY = 'tbkey-secret-0123456789';

const client = (
  respond: () => Response | Promise<Response>,
  seen: Array<{ url: string; headers: Record<string, string> }> = [],
) =>
  new TorboxClient({
    baseUrl: 'https://api.torbox.test',
    apiKey: KEY,
    fetch: async (url, init) => {
      seen.push({ url, headers: init.headers });
      return respond();
    },
  });

describe('parseMylist', () => {
  it('reads the fields the poller needs and lower-cases hashes', () => {
    const items = parseMylist({
      success: true,
      data: [
        {
          hash: 'ABCDEF',
          alternative_hashes: ['FEDCBA', 7],
          name: 'Release',
          download_state: 'downloading',
          progress: 0.42,
          eta: 90.4,
          download_finished: false,
          download_present: false,
          auth_id: 'ignored',
        },
        { name: 'no hash' },
        null,
      ],
    });
    expect(items).toEqual([
      {
        hash: 'abcdef',
        alternativeHashes: ['fedcba'],
        name: 'Release',
        downloadState: 'downloading',
        progress: 0.42,
        etaSec: 90,
        downloadFinished: false,
        downloadPresent: false,
      },
    ]);
  });

  it('treats missing numbers as no progress and no eta', () => {
    expect(parseMylist({ data: [{ hash: 'aa' }] })[0]).toMatchObject({
      progress: 0,
      etaSec: null,
      downloadFinished: false,
    });
  });

  it('rejects an answer without a data array', () => {
    expect(() => parseMylist({ success: false })).toThrow(TorboxError);
    expect(() => parseMylist(null)).toThrow(TorboxError);
  });
});

describe('TorboxClient.list', () => {
  it('asks for the uncached list with the bearer key', async () => {
    const seen: Array<{ url: string; headers: Record<string, string> }> = [];
    const items = await client(() => new Response(JSON.stringify({ data: [{ hash: 'aa' }] })), seen).list();
    expect(items).toHaveLength(1);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.url).toBe('https://api.torbox.test/v1/api/torrents/mylist?bypass_cache=true');
    expect(seen[0]?.headers.Authorization).toBe(`Bearer ${KEY}`);
  });

  it.each([401, 403])('maps HTTP %i to an auth error without the key in the message', async (status) => {
    const error = await client(() => new Response('no', { status }))
      .list()
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TorboxError);
    expect((error as TorboxError).kind).toBe('auth');
    expect((error as TorboxError).message).not.toContain(KEY);
  });

  it.each([429, 500, 503])('maps HTTP %i to unavailable', async (status) => {
    const error = await client(() => new Response('no', { status }))
      .list()
      .catch((e: unknown) => e);
    expect((error as TorboxError).kind).toBe('unavailable');
  });

  it('maps network failures and unreadable bodies to unavailable', async () => {
    const network = await client(() => Promise.reject(new Error(`connect failed for ${KEY}`)))
      .list()
      .catch((e: unknown) => e);
    expect((network as TorboxError).kind).toBe('unavailable');
    expect((network as TorboxError).message).not.toContain(KEY);
    const garbage = await client(() => new Response('<html>'))
      .list()
      .catch((e: unknown) => e);
    expect((garbage as TorboxError).kind).toBe('unavailable');
  });
});
