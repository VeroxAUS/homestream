import type { GithubClient } from './lib/github.mjs';

export function readTests(reportsDir: string): Record<string, number> | null;
export function pullRequestOf(env: NodeJS.ProcessEnv): { number: number; fromFork: boolean } | null;
export function main(
  argv: string[],
  env?: NodeJS.ProcessEnv,
  github?: Pick<GithubClient, 'request' | 'paginate'> | null,
): Promise<number>;
