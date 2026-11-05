import { AppError } from '../errors.js';

export function parseId(raw: string, name: string, min: number): number {
  const value = /^\d{1,15}$/.test(raw) ? Number(raw) : Number.NaN;
  if (!Number.isSafeInteger(value) || value < min) {
    throw new AppError(
      400,
      'invalid_request',
      `${name} must be a whole number${min > 0 ? ' greater than 0' : ''}, got "${raw.slice(0, 40)}".`,
      'Use the numeric TMDB id, for example /api/movie/278.',
    );
  }
  return value;
}
