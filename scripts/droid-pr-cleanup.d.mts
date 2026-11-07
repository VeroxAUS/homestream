import type { GithubClient } from './lib/github.mjs';

export function main(
  env?: NodeJS.ProcessEnv,
  deps?: { github?: Pick<GithubClient, 'request' | 'paginate'> | null },
): Promise<number>;
