import type { GithubClient } from './lib/github.mjs';
import type { DroidRunOptions, Review } from './lib/droid.mjs';

export interface IssueLike {
  number: number;
  title: string;
  body?: string;
  state?: string;
  pull_request?: unknown;
}
export const ISSUE_TITLE: string;
export function markerFor(sha: string): string;
export function lastReviewedSha(issue: Pick<IssueLike, 'body'> | null | undefined): string | null;
export function pickIssue<T extends IssueLike>(issues: T[]): T | null;
export function decide(input: {
  lastSha: string | null;
  head: string;
  known: boolean;
  codeCommits: number;
  windowStart: string;
}): { run: boolean; base?: string; reason: string };
export function buildPrompt(input: {
  base: string;
  head: string;
  commits: string;
  diffFile: string;
  truncated: boolean;
  limits: string;
}): string;
export function renderIssueBody(input: {
  review: Pick<Review, 'summary' | 'findings'>;
  base: string;
  head: string;
  commitCount: number;
  runUrl: string;
  date: string;
}): string;
export function findIssue(github: Pick<GithubClient, 'paginate'>): Promise<IssueLike | null>;
export function plan(
  env?: NodeJS.ProcessEnv,
  deps?: { github?: Pick<GithubClient, 'request' | 'paginate'> | null; cwd?: string },
): Promise<number>;
export function review(
  env?: NodeJS.ProcessEnv,
  deps?: {
    github?: Pick<GithubClient, 'request' | 'paginate'> | null;
    run?: (options: DroidRunOptions) => Promise<string>;
    cwd?: string;
  },
): Promise<number>;
