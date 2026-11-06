export type Bump = 'none' | 'patch' | 'minor' | 'major';
export interface ParsedCommit {
  type: string;
  scope: string;
  breaking: boolean;
  description: string;
}
export interface RawCommit {
  sha: string;
  subject: string;
  body: string;
}
export interface ReleasePlan {
  release: boolean;
  bump: Bump | 'initial';
  version: string;
  previous: string | null;
  commits: Array<RawCommit & { parsed: ParsedCommit | null }>;
}
export const FIRST_VERSION: string;
export function parseCommit(subject: string, body?: string): ParsedCommit | null;
export function bumpFor(commit: ParsedCommit | null): Bump;
export function highestBump(commits: Array<ParsedCommit | null>): Bump;
export function applyBump(version: string, bump: Bump): string;
export function planRelease(lastTag: string | null, commits: RawCommit[]): ReleasePlan;
export function formatCommitNotes(plan: ReleasePlan): string;
export function parseArgs(argv: string[]): {
  dryRun: boolean;
  json: boolean;
  sha: string;
  notesFile: string | null;
} | null;
export function main(argv: string[], cwd?: string, env?: NodeJS.ProcessEnv): number;
