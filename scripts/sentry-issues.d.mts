export interface SentryIssueLike {
  shortId: string;
  title: string;
  culprit?: string;
  level?: string;
  count?: string | number;
  firstSeen?: string;
  lastSeen?: string;
  permalink?: string;
  project?: { slug?: string };
  metadata?: { type?: string; value?: string };
}
export interface IssueDraft {
  title: string;
  body: string;
  labels: string[];
}
export function scrub(text: unknown): string;
export function isSmokeError(issue: Partial<SentryIssueLike>): boolean;
export function areaLabel(issue: Partial<SentryIssueLike>): string;
export function issueTitle(issue: SentryIssueLike): string;
export function issueBody(issue: SentryIssueLike): string;
export function knownShortIds(githubIssues: Array<{ title?: string }>): Set<string>;
export function planIssues(
  sentryIssues: SentryIssueLike[],
  githubIssues: Array<{ title?: string }>,
): { create: IssueDraft[]; skipped: { smoke: number; duplicate: number } };
export function main(argv: string[], env?: NodeJS.ProcessEnv, fetchImpl?: typeof fetch): Promise<number>;
