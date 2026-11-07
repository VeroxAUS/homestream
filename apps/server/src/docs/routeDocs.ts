import {
  ActivityResponseSchema,
  CapabilityProfileSchema,
  ContinueWatchingRemoveResponseSchema,
  ContinueWatchingResponseSchema,
  DeviceSchema,
  DevicesResponseSchema,
  DownloadStartedResponseSchema,
  DownloadsResponseSchema,
  HealthResponseSchema,
  HealthzResponseSchema,
  HistoryQuerySchema,
  HistoryResponseSchema,
  HomeResponseSchema,
  LogsQuerySchema,
  LogsResponseSchema,
  MovieDetailsWithDownloadSchema,
  PrefetchRequestSchema,
  PrefetchResponseSchema,
  ProgressPingRequestSchema,
  ProgressResponseSchema,
  ReadyzResponseSchema,
  SearchQuerySchema,
  SearchResponseSchema,
  SeasonSchema,
  ServerInfoSchema,
  SessionPatchRequestSchema,
  SessionResponseSchema,
  SessionStartRequestSchema,
  ShowDetailsWithDownloadsSchema,
  ShowProgressResponseSchema,
  StatsGraphsResponseSchema,
  StatsQuerySchema,
  StatsSummaryResponseSchema,
  StreamsQuerySchema,
  StreamsResponseSchema,
} from '@homestream/shared';
import { z, type ZodType } from 'zod';

export interface ResponseDoc {
  description: string;
  /** Omitted for responses without a JSON body. */
  schema?: ZodType;
  /** Defaults to `application/json`. */
  contentType?: string;
}

export interface RouteDoc {
  summary: string;
  description?: string;
  tag: string;
  /** Description per `:param` in the path; parameters without an entry are still documented as strings. */
  params?: Record<string, string>;
  query?: ZodType;
  body?: ZodType;
  responses: Record<number, ResponseDoc>;
  /** Error statuses this route can answer with the shared `{error:{code,message,hint?}}` body. */
  errors: number[];
}

type DocInput = Omit<RouteDoc, 'responses' | 'errors'> & { errors?: number[] };

const ok = (schema: ZodType, description = 'Success.'): Record<number, ResponseDoc> => ({
  200: { description, schema },
});

function doc(input: DocInput, responses: Record<number, ResponseDoc>): RouteDoc {
  return { ...input, responses, errors: input.errors ?? [] };
}

const TMDB_ID = { tmdbId: 'TMDB id, a positive whole number.' };
const SESSION_ID = { id: 'Playback session id returned by POST /api/sessions.' };
const MEDIA_KEY = { mediaKey: 'Progress key such as `movie:278` or `tv:1396:1:1`.' };
const HLS_ID = { id: 'Playback session id.' };

const SessionStopped = z.object({ sessionId: z.string(), state: z.literal('stopped') });
const DownloadCancelled = z.object({ id: z.string(), state: z.literal('cancelled') });

/** Documentation for every API route, keyed by `METHOD /fastify/route/:url`. A route without an entry fails the openapi tests. */
export const ROUTE_DOCS: Record<string, RouteDoc> = {
  'GET /api/info': doc(
    { summary: 'Server identity and LAN addresses', tag: 'server', description: 'Used by clients to find the server.' },
    ok(ServerInfoSchema),
  ),
  'POST /api/devices': doc(
    { summary: 'Register or update a device', tag: 'devices', body: CapabilityProfileSchema, errors: [400] },
    ok(DeviceSchema, 'The stored device.'),
  ),
  'GET /api/devices': doc({ summary: 'List known devices', tag: 'devices' }, ok(DevicesResponseSchema)),

  'GET /api/home': doc({ summary: 'Home screen rows', tag: 'catalog', errors: [502, 503] }, ok(HomeResponseSchema)),
  'GET /api/search': doc(
    { summary: 'Search movies and shows', tag: 'catalog', query: SearchQuerySchema, errors: [400, 502, 503] },
    ok(SearchResponseSchema),
  ),
  'GET /api/movie/:tmdbId': doc(
    { summary: 'Movie details', tag: 'catalog', params: TMDB_ID, errors: [400, 404, 502, 503] },
    ok(MovieDetailsWithDownloadSchema, 'Movie details, with the TorBox download when one is tracked.'),
  ),
  'GET /api/tv/:tmdbId': doc(
    { summary: 'Show details', tag: 'catalog', params: TMDB_ID, errors: [400, 404, 502, 503] },
    ok(ShowDetailsWithDownloadsSchema, 'Show details, with tracked downloads when there are any.'),
  ),
  'GET /api/tv/:tmdbId/season/:n': doc(
    {
      summary: 'Season with its episodes',
      tag: 'catalog',
      params: { ...TMDB_ID, n: 'Season number, 0 for specials.' },
      errors: [400, 404, 502, 503],
    },
    ok(SeasonSchema),
  ),

  'GET /api/streams/movie/:tmdbId': doc(
    {
      summary: 'Streams for a movie',
      tag: 'streams',
      params: TMDB_ID,
      query: StreamsQuerySchema,
      errors: [400, 404, 502],
    },
    ok(StreamsResponseSchema, 'Ranked streams for the device; `recommendedId` is the automatic pick.'),
  ),
  'GET /api/streams/tv/:tmdbId/:season/:episode': doc(
    {
      summary: 'Streams for an episode',
      tag: 'streams',
      params: { ...TMDB_ID, season: 'Season number.', episode: 'Episode number.' },
      query: StreamsQuerySchema,
      errors: [400, 404, 502],
    },
    ok(StreamsResponseSchema, 'Ranked streams for the device; `recommendedId` is the automatic pick.'),
  ),

  'POST /api/sessions': doc(
    {
      summary: 'Start a playback session',
      description:
        'Clients send `streamId: "auto"`. Answers 201 with the session, or 202 when the title had no cached stream (or the explicit `streamId` is not cached) and TorBox was asked to cache it. A stream the gateway answers with its "downloading" clip is never played.',
      tag: 'sessions',
      body: SessionStartRequestSchema,
      errors: [400, 404, 409, 429, 502, 503, 504],
    },
    {
      201: { description: 'Session started.', schema: SessionResponseSchema },
      202: { description: 'Download started instead of a session.', schema: DownloadStartedResponseSchema },
    },
  ),
  'GET /api/activity': doc(
    { summary: 'Live playback sessions', tag: 'sessions' },
    ok(ActivityResponseSchema, 'Active sessions with encoder and network details.'),
  ),
  'GET /api/sessions/:id': doc(
    { summary: 'Get a session', tag: 'sessions', params: SESSION_ID, errors: [404] },
    ok(SessionResponseSchema),
  ),
  'PATCH /api/sessions/:id': doc(
    {
      summary: 'Change audio or subtitle track',
      description:
        'Restarts the encoder at the current position when the change needs it. Answers 503 `encoder_not_stopped` (nothing is changed) when the old encoder has not exited yet; retry after a few seconds.',
      tag: 'sessions',
      params: SESSION_ID,
      body: SessionPatchRequestSchema,
      errors: [400, 404, 409, 502, 503, 504],
    },
    ok(SessionResponseSchema),
  ),
  'DELETE /api/sessions/:id': doc(
    {
      summary: 'Stop a session',
      description: 'Send the request without a body and without a content-type header.',
      tag: 'sessions',
      params: SESSION_ID,
      errors: [404],
    },
    ok(SessionStopped),
  ),
  'POST /api/sessions/:id/progress': doc(
    {
      summary: 'Report playback position',
      tag: 'progress',
      params: SESSION_ID,
      body: ProgressPingRequestSchema,
      errors: [400, 404],
    },
    ok(ProgressResponseSchema),
  ),

  'GET /api/progress/:mediaKey': doc(
    { summary: 'Saved progress of a title', tag: 'progress', params: MEDIA_KEY, errors: [404] },
    ok(ProgressResponseSchema),
  ),
  'GET /api/tv/:tmdbId/progress': doc(
    {
      summary: 'Saved progress of every episode of a show',
      tag: 'progress',
      params: TMDB_ID,
      errors: [400],
    },
    ok(ShowProgressResponseSchema),
  ),
  'GET /api/continue-watching': doc(
    { summary: 'Continue watching row', tag: 'progress', errors: [502, 503] },
    ok(ContinueWatchingResponseSchema),
  ),
  'DELETE /api/continue-watching/:mediaKey': doc(
    { summary: 'Remove a title from continue watching', tag: 'progress', params: MEDIA_KEY, errors: [404] },
    ok(ContinueWatchingRemoveResponseSchema),
  ),

  'GET /api/downloads': doc(
    { summary: 'TorBox downloads being tracked', tag: 'downloads' },
    ok(DownloadsResponseSchema),
  ),
  'DELETE /api/downloads/:id': doc(
    {
      summary: 'Stop tracking a download',
      tag: 'downloads',
      params: { id: 'Download id from GET /api/downloads.' },
      errors: [404],
    },
    ok(DownloadCancelled),
  ),

  'GET /api/history': doc(
    { summary: 'Playback history', tag: 'history', query: HistoryQuerySchema, errors: [400] },
    ok(HistoryResponseSchema),
  ),
  'GET /api/stats/summary': doc(
    { summary: 'Viewing statistics summary', tag: 'history', query: StatsQuerySchema, errors: [400] },
    ok(StatsSummaryResponseSchema),
  ),
  'GET /api/stats/graphs': doc(
    { summary: 'Viewing statistics for charts', tag: 'history', query: StatsQuerySchema, errors: [400] },
    ok(StatsGraphsResponseSchema),
  ),

  'POST /api/prefetch': doc(
    {
      summary: 'Warm up the stream the next start would pick',
      tag: 'sessions',
      body: PrefetchRequestSchema,
      errors: [400],
    },
    { 202: { description: 'Accepted; warm-up continues in the background.', schema: PrefetchResponseSchema } },
  ),

  'GET /api/health': doc({ summary: 'Latest health checks', tag: 'health' }, ok(HealthResponseSchema)),
  'POST /api/health/run': doc(
    {
      summary: 'Run the health checks now',
      tag: 'health',
      query: z.object({ fresh: z.enum(['1', 'true']).optional() }),
    },
    ok(HealthResponseSchema),
  ),
  'GET /api/logs': doc(
    { summary: 'Recent server events', tag: 'health', query: LogsQuerySchema, errors: [400] },
    ok(LogsResponseSchema),
  ),
  'GET /api/events': doc(
    {
      summary: 'Server-sent events stream',
      description:
        'Events: `heartbeat`, `log`, `health`, `session` and download notifications. Each frame is `event: <name>` plus a JSON `data:` line.',
      tag: 'health',
    },
    { 200: { description: 'Open event stream.', contentType: 'text/event-stream', schema: z.string() } },
  ),

  'GET /healthz': doc(
    {
      summary: 'Liveness probe',
      description: 'Answers 200 while the process serves requests. Makes no external calls.',
      tag: 'ops',
    },
    ok(HealthzResponseSchema, 'The process is alive.'),
  ),
  'GET /readyz': doc(
    {
      summary: 'Readiness probe',
      description:
        'Checks the database and that the data directory is writable (it writes and removes a small file, so it is limited to 300 requests per minute per client address). Makes no external calls (TMDB, gateway, TorBox).',
      tag: 'ops',
      errors: [429, 503],
    },
    ok(ReadyzResponseSchema, 'Database and data directory are usable.'),
  ),
  'GET /metrics': doc(
    {
      summary: 'Prometheus metrics',
      description:
        'Text exposition format. Label values are route templates, status codes and short fixed codes; never ids, secrets or hosts.',
      tag: 'ops',
    },
    { 200: { description: 'Prometheus text format.', contentType: 'text/plain', schema: z.string() } },
  ),

  'GET /hls/:id/:file': doc(
    {
      summary: 'HLS playlist, init segment or media segment',
      description:
        'One of `index.m3u8`, `video.m3u8`, `init.mp4` or `seg-N`. Waits for a segment that is still encoding. A seek answers 503 `encoder_not_stopped` when the previous encoder has not exited yet; retry after a few seconds.',
      tag: 'hls',
      params: { ...HLS_ID, file: 'File name inside the session.' },
      errors: [404, 502, 503, 504],
    },
    {
      200: {
        description: 'Playlist text or media bytes.',
        contentType: 'application/octet-stream',
        schema: z.string(),
      },
    },
  ),
  'GET /hls/:id/subs/:file': doc(
    {
      summary: 'Complete sidecar subtitle file',
      tag: 'hls',
      params: { ...HLS_ID, file: 'Subtitle file name, for example `0.vtt`.' },
      errors: [404],
    },
    { 200: { description: 'WebVTT text.', contentType: 'text/vtt', schema: z.string() } },
  ),
  'GET /hls/:id/subs/:idx/:file': doc(
    {
      summary: 'Subtitle playlist or segment',
      tag: 'hls',
      params: { ...HLS_ID, idx: 'Subtitle track index.', file: '`index.m3u8` or a subtitle segment name.' },
      errors: [404, 504],
    },
    { 200: { description: 'Playlist or WebVTT text.', contentType: 'text/vtt', schema: z.string() } },
  ),
};

export const TAG_DESCRIPTIONS: Record<string, string> = {
  server: 'Server identity.',
  devices: 'Client devices and their capabilities.',
  catalog: 'Movies and shows from TMDB.',
  streams: 'Stream lists from the gateway.',
  sessions: 'Playback sessions and prefetching.',
  progress: 'Resume positions and continue watching.',
  downloads: 'TorBox caching of titles with no cached stream.',
  history: 'Playback history and statistics.',
  health: 'Health checks, events and logs.',
  hls: 'HLS playlists and segments of a session.',
  ops: 'Probes and metrics for monitoring. Served at the root, outside /api.',
};
