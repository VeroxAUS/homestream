import {
  ProgressPingRequestSchema,
  type ContinueWatchingRemoveResponse,
  type ContinueWatchingResponse,
  type ProgressResponse,
} from '@homestream/shared';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import { getProgress } from '../db/progress.js';
import { AppError, invalidRequest } from '../errors.js';
import { isResumable } from '../progress/rules.js';

const MAX_KEY_LENGTH = 64;

function unknownKey(mediaKey: string): AppError {
  return new AppError(
    404,
    'not_found',
    `No progress is saved for "${mediaKey.slice(0, MAX_KEY_LENGTH)}".`,
    'Keys look like movie:278 or tv:1396:1:1, and exist once a title has been played.',
  );
}

export function registerProgressRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db, playback, continueWatching } = ctx;

  app.post<{ Params: { id: string } }>('/api/sessions/:id/progress', async (request): Promise<ProgressResponse> => {
    const parsed = ProgressPingRequestSchema.safeParse(request.body);
    if (!parsed.success) throw invalidRequest(parsed.error);
    return playback.ping(request.params.id, parsed.data);
  });

  app.get<{ Params: { mediaKey: string } }>('/api/progress/:mediaKey', async (request): Promise<ProgressResponse> => {
    const { mediaKey } = request.params;
    const row = mediaKey.length <= MAX_KEY_LENGTH ? getProgress(db, mediaKey) : null;
    if (!row) throw unknownKey(mediaKey);
    return {
      mediaKey: row.mediaKey,
      positionSec: row.positionSec,
      durationSec: row.durationSec,
      completed: row.completed,
      resumable: isResumable(row.positionSec, row.completed),
    };
  });

  app.get('/api/continue-watching', async (): Promise<ContinueWatchingResponse> => ({ items: await continueWatching.list() }));

  app.delete<{ Params: { mediaKey: string } }>(
    '/api/continue-watching/:mediaKey',
    async (request): Promise<ContinueWatchingRemoveResponse> => {
      const { mediaKey } = request.params;
      const result = mediaKey.length <= MAX_KEY_LENGTH ? await continueWatching.remove(mediaKey) : null;
      if (!result) throw unknownKey(mediaKey);
      return { mediaKey, removed: result.removed };
    },
  );
}
