import type { GithubClient } from './lib/github.mjs';
import type { DroidRunOptions, Review, ReviewFinding } from './lib/droid.mjs';

export const SUMMARY_MARKER: string;
export const INLINE_MARKER: string;
export function commentableLines(diff: string): Map<string, Set<number>>;
export function buildPrompt(input: { sha: string; base: string; diffFile: string; truncated: boolean }): string;
export function renderInline(finding: ReviewFinding): string;
export function renderSummary(input: {
  review: Pick<Review, 'summary' | 'findings'>;
  sha: string;
  base: string;
  runUrl: string;
  inlinePosted: number;
  leftOver: ReviewFinding[];
  failure?: string;
}): string;
export function planFindings(
  findings: ReviewFinding[],
  lines: Map<string, Set<number>>,
): { inline: ReviewFinding[]; leftOver: ReviewFinding[] };
export function main(
  env?: NodeJS.ProcessEnv,
  deps?: {
    github?: Pick<GithubClient, 'request' | 'paginate'> | null;
    run?: (options: DroidRunOptions) => Promise<string>;
    cwd?: string;
  },
): Promise<number>;
