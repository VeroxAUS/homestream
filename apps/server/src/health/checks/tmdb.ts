import type { Config } from '../../config.js';
import { AppError } from '../../errors.js';
import { failure, type CheckOutcome } from './types.js';

export interface TmdbCheckDeps {
  config: Pick<Config, 'tmdbReadToken' | 'configFile'>;
  ping: () => Promise<void>;
}

export async function checkTmdb({ config, ping }: TmdbCheckDeps): Promise<CheckOutcome> {
  const details = { endpoint: '/configuration' };
  if (!config.tmdbReadToken) {
    return failure(
      'TMDB is not configured (TMDB_READ_TOKEN is missing).',
      `Add TMDB_READ_TOKEN=<your TMDB API Read Access Token> to ${config.configFile.path} and restart HomeStream.`,
      details,
    );
  }
  try {
    await ping();
  } catch (error) {
    if (error instanceof AppError && error.code === 'tmdb_auth_failed') {
      return failure(
        'TMDB rejected the token.',
        `Replace TMDB_READ_TOKEN in ${config.configFile.path} with the "API Read Access Token" from themoviedb.org > Settings > API, then restart HomeStream.`,
        details,
      );
    }
    return failure(
      'TMDB could not be reached.',
      "TMDB unreachable - check this PC's internet connection. TMDB may also be down; try again in a few minutes.",
      details,
    );
  }
  return { status: 'ok', message: 'TMDB answers and accepts the token.', details };
}
