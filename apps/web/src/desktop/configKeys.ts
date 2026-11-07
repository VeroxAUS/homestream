import type { HealthResponse } from '@homestream/shared';
export interface ConfigKey {
  name: string;
  required: boolean;
  present: boolean;
}

function isConfigKey(value: unknown): value is ConfigKey {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Record<string, unknown>;
  return typeof item.name === 'string' && typeof item.required === 'boolean' && typeof item.present === 'boolean';
}

/** What each key is for and where to get it; the words are fixed by the design. */
export const KEY_HELP: Record<string, string> = {
  TMDB_READ_TOKEN: 'Titles, posters and artwork. From themoviedb.org > Settings > API (API Read Access Token).',
  GATEWAY_MANIFEST_URL: 'Finds a stream for each title. Your AIOStreams manifest link.',
  TORBOX_API_KEY: 'Downloads and caches titles. From torbox.app > Settings.',
};

const KEY_ORDER = ['TMDB_READ_TOKEN', 'GATEWAY_MANIFEST_URL', 'TORBOX_API_KEY'];

/** The keys the `config` health check lists (names and whether they are set, never values), or `null` when unknown. */
export function configKeys(health: HealthResponse | undefined): ConfigKey[] | null {
  const check = health?.checks.find((item) => item.id === 'config');
  const keys = check?.details.keys;
  if (!Array.isArray(keys) || !keys.every(isConfigKey)) return null;
  const rank = (name: string): number => {
    const index = KEY_ORDER.indexOf(name);
    return index === -1 ? KEY_ORDER.length : index;
  };
  return [...keys].sort((a, b) => rank(a.name) - rank(b.name));
}

export function missingRequired(keys: ConfigKey[] | null): ConfigKey[] {
  return (keys ?? []).filter((key) => key.required && !key.present);
}
