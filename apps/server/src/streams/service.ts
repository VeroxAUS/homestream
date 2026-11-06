import type { StreamOption, StreamsResponse } from '@homestream/shared';
import type { Db } from '../db/index.js';
import { getDevice } from '../db/devices.js';
import type { GatewayClient } from '../gateway/client.js';
import { queryFromKey, queryKey, type GatewayStream, type StreamQuery } from '../gateway/types.js';
import { matchesEpisode } from './episode.js';
import { parseStream } from './parse.js';
import { deviceMaxRank, rankStreams, recommendStream } from './rank.js';

export interface ResolvedStream {
  id: string;
  /** Raw gateway playback URL. Server-side only. */
  url: string;
  stream: StreamOption;
  /** The gateway record, including the TorBox info hash when AIOStreams sent it. Server-side only. */
  raw: GatewayStream;
}

export class StreamService {
  constructor(
    private readonly gateway: GatewayClient,
    private readonly db: Db,
  ) {}

  async list(query: StreamQuery, deviceId?: string): Promise<StreamsResponse> {
    return this.rank(await this.gateway.lookup(query), query, deviceId);
  }

  /** Like `list`, but skips the gateway cache (and refreshes it), so a download that just finished shows as cached. */
  async refresh(query: StreamQuery): Promise<StreamsResponse> {
    return this.rank(await this.gateway.lookup(query, { fresh: true }), query);
  }

  /** Like `list`, but only from a fresh gateway cache entry: never waits for or triggers a lookup. Null when not cached. */
  cachedList(query: StreamQuery, deviceId?: string): StreamsResponse | null {
    const entry = this.gateway.cache.getFresh(queryKey(query));
    return entry ? this.rank(entry.streams, query, deviceId) : null;
  }

  private rank(raw: GatewayStream[], query: StreamQuery, deviceId?: string): StreamsResponse {
    const relevant =
      query.type === 'tv' ? raw.filter((stream) => matchesEpisode(stream.filename, query.season, query.episode)) : raw;
    const ranked = rankStreams(relevant.map(parseStream));
    if (ranked.length === 0) return { streams: [], recommendedId: null, reason: 'no_streams' };

    const device = deviceId ? getDevice(this.db, deviceId) : null;
    const recommended = recommendStream(ranked, device ? deviceMaxRank(device.capabilities) : null);
    return { streams: ranked, recommendedId: recommended?.id ?? null };
  }

  /**
   * Resolves a stream id from an earlier list to its raw gateway URL. When the cached list has expired it is
   * fetched again (through the shared rate limiter); null means the gateway no longer offers that stream.
   */
  async getStreamById(id: string): Promise<ResolvedStream | null> {
    const entry = this.gateway.cache.findByStreamId(id);
    if (!entry) return null;

    let raw: GatewayStream | undefined;
    if (this.gateway.cache.isFresh(entry)) {
      raw = entry.streams.find((stream) => stream.id === id);
    } else {
      const query = queryFromKey(entry.key);
      if (!query) return null;
      raw = (await this.gateway.lookup(query)).find((stream) => stream.id === id);
    }
    return raw ? { id, url: raw.url, stream: parseStream(raw), raw } : null;
  }
}
