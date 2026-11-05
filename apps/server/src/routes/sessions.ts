import { createReadStream } from 'node:fs';
import {
  SessionPatchRequestSchema,
  SessionStartRequestSchema,
  type ActivityResponse,
  type SessionResponse,
} from '@homestream/shared';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import { AppError, invalidRequest } from '../errors.js';
import { stripIpv6Prefix } from '../net.js';
import { parseHlsFileName } from '../playback/playlist.js';
import { parseSubtitleFileName } from '../playback/subtitleExtractor.js';

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

  app.get<{ Params: { id: string; file: string } }>('/hls/:id/subs/:file', async (request, reply) => {
    const index = parseSubtitleFileName(request.params.file);
    if (index === null) {
      throw new AppError(404, 'not_found', `Unknown subtitle file "${request.params.file.slice(0, 40)}".`, 'Use the url of a subtitle track from the session.');
    }
    const served = playback.serveSubtitle(request.params.id, index);
    reply.header('Content-Type', served.contentType).header('Cache-Control', 'no-cache');
    if (served.kind === 'text') return reply.send(served.body);
    reply.header('Content-Length', served.size);
    return reply.send(createReadStream(served.path));
  });

  app.get<{ Params: { id: string; file: string } }>('/hls/:id/:file', async (request, reply) => {
    const file = parseHlsFileName(request.params.file);
    if (!file) {
      throw new AppError(404, 'not_found', `Unknown HLS file "${request.params.file.slice(0, 40)}".`, 'Use index.m3u8, init.mp4 or a seg-N file.');
    }
    const served = await playback.serve(request.params.id, file);
    reply.header('Content-Type', served.contentType).header('Cache-Control', 'no-cache');
    if (served.kind === 'text') return reply.send(served.body);
    reply.header('Content-Length', served.size);
    return reply.send(createReadStream(served.path));
  });
}
