export class GithubError extends Error {
  constructor(method: string, route: string, status: number, detail: string);
  status: number;
}
export interface GithubComment {
  id: number;
  body?: string;
  user?: { type?: string };
  html_url?: string;
}
export interface GithubClient {
  repository: string;
  request(method: string, route: string, body?: unknown): Promise<unknown>;
  paginate(route: string, options?: { maxPages?: number }): Promise<unknown[]>;
}
export function githubClient(options: {
  token?: string;
  repository: string;
  fetchImpl?: typeof fetch;
  base?: string;
  retryDelayMs?: number;
  sleepImpl?: (ms: number) => Promise<void>;
}): GithubClient;
export function neutralizeMentions(text: unknown): string;
export function clampBody(text: string, max?: number): string;
export function redactValues(text: unknown, values: Array<string | undefined>): string;
export function pruneMarkedComments(
  github: Pick<GithubClient, 'request' | 'paginate'>,
  issueNumber: number,
  marker: string,
): Promise<number[]>;
export function upsertMarkedComment(
  github: Pick<GithubClient, 'request' | 'paginate'>,
  issueNumber: number,
  marker: string,
  body: string,
): Promise<GithubComment>;
