import { createReadStream } from 'node:fs';
import {
  SessionPatchRequestSchema,
  SessionStartRequestSchema,
  type ActivityResponse,
  type SessionResponse,
} from '@homestream/shared';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { AppContext } from '../context.js';
import { AppError, invalidRequest } from '../errors.js';
import { stripIpv6Prefix } from '../net.js';
import type { ServedFile } from '../playback/manager.js';
import { parseHlsFileName, parseSubtitleFullName, parseSubtitleSegmentName } from '../playback/playlist.js';

const SUBTITLE_PLAYLIST = 'index.m3u8';

export function registerSessionRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { playback } = ctx;

  app.post('/api/sessions', async (request, reply): Promise<SessionResponse> => {
    const parsed = SessionStartRequestSchema.safeParse(request.body);
    if (!parsed.success) throw invalidRequest(parsed.error);
    const session = await playback.start(parsed.data, stripIpv6Prefix(request.ip));
    return reply.code(201).send(session);
  });

  app.get('/api/activity', async (): Promise<ActivityResponse> => ({ sessions: playback.activity() }));

  app.get<{ Params: { id: string } }>('/api/sessions/:id', async (request): Promise<SessionResponse> =>
    playback.get(request.params.id),
  );

  app.patch<{ Params: { id: string } }>('/api/sessions/:id', async (request): Promise<SessionResponse> => {
    playback.get(request.params.id);
    const parsed = SessionPatchRequestSchema.safeParse(request.body ?? {});
    if (!parsed.success) throw invalidRequest(parsed.error);
    return playback.patch(request.params.id, parsed.data);
  });

  app.delete<{ Params: { id: string } }>('/api/sessions/:id', async (request) => {
    await playback.stop(request.params.id);
    return { sessionId: request.params.id, state: 'stopped' };
  });

  const send = (reply: FastifyReply, served: ServedFile) => {
    reply.header('Content-Type', served.contentType).header('Cache-Control', 'no-cache');
    if (served.kind === 'text') {
      if (served.headers) reply.headers(served.headers);
      return reply.send(served.body);
    }
    reply.header('Content-Length', served.size);
    return reply.send(createReadStream(served.path));
  };

  const unknownSubtitleFile = (name: string) =>
    new AppError(404, 'not_found', `Unknown subtitle file "${name.slice(0, 40)}".`, 'Use the subtitle urls listed in the session or in index.m3u8.');

  app.get<{ Params: { id: string; file: string } }>('/hls/:id/subs/:file', async (request, reply) => {
    const index = parseSubtitleFullName(request.params.file);
    if (index === null) throw unknownSubtitleFile(request.params.file);
    return send(reply, playback.serveSubtitleFull(request.params.id, index));
  });

  app.get<{ Params: { id: string; idx: string; file: string } }>('/hls/:id/subs/:idx/:file', async (request, reply) => {
    const index = /^\d{1,4}$/.test(request.params.idx) ? Number(request.params.idx) : null;
    if (index === null) throw unknownSubtitleFile(request.params.idx);
    if (request.params.file === SUBTITLE_PLAYLIST) return send(reply, playback.serveSubtitlePlaylist(request.params.id, index));
    const segment = parseSubtitleSegmentName(request.params.file);
    if (segment === null) throw unknownSubtitleFile(request.params.file);
    const aborted = new AbortController();
    reply.raw.once('close', () => {
      if (!reply.raw.writableFinished) aborted.abort();
    });
    return send(reply, await playback.serveSubtitleSegment(request.params.id, index, segment, aborted.signal));
  });

  app.get<{ Params: { id: string; file: string } }>('/hls/:id/:file', async (request, reply) => {
    const file = parseHlsFileName(request.params.file);
    if (!file) {
      throw new AppError(404, 'not_found', `Unknown HLS file "${request.params.file.slice(0, 40)}".`, 'Use index.m3u8, video.m3u8, init.mp4 or a seg-N file.');
    }
    return send(reply, await playback.serve(request.params.id, file));
  });
}
