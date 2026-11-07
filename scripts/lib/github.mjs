const API_BASE = 'https://api.github.com';
const REQUEST_TIMEOUT_MS = 30_000;
const RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 3;
const MAX_BODY = 60_000;
const ZERO_WIDTH_SPACE = '\u200b';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class GithubError extends Error {
  constructor(method, route, status, detail) {
    super(`${method} ${route} answered ${status}: ${detail}`);
    this.name = 'GithubError';
    this.status = status;
  }
}

/**
 * Minimal GitHub REST client: JSON in and out, a timeout on every request, a short retry on 429 and 5xx.
 * `route` is a path such as `/repos/OWNER/REPO/issues`; `{repo}` expands to the client's repository.
 */
export function githubClient({
  token,
  repository,
  fetchImpl = fetch,
  base = API_BASE,
  retryDelayMs = 1500,
  sleepImpl = sleep,
}) {
  const expand = (route) => route.replaceAll('{repo}', `/repos/${repository}`).replace(/^(?!\/)/, '/');

  async function request(method, route, body) {
    const url = `${base}${expand(route)}`;
    let last;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      const response = await fetchImpl(url, {
        method,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: {
          authorization: `Bearer ${token}`,
          accept: 'application/vnd.github+json',
          'x-github-api-version': '2022-11-28',
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (response.ok) return response.status === 204 ? null : response.json();
      const detail = (await response.text()).replace(/\s+/g, ' ').slice(0, 300);
      last = new GithubError(method, new URL(url).pathname, response.status, detail);
      if (!RETRY_STATUSES.has(response.status) || attempt === MAX_ATTEMPTS) break;
      await sleepImpl(retryDelayMs * attempt);
    }
    throw last;
  }

  async function paginate(route, { maxPages = 20 } = {}) {
    const joiner = route.includes('?') ? '&' : '?';
    const all = [];
    for (let page = 1; page <= maxPages; page += 1) {
      const batch = await request('GET', `${route}${joiner}per_page=100&page=${page}`);
      all.push(...batch);
      if (batch.length < 100) break;
    }
    return all;
  }

  return { request, paginate, repository };
}

/** Text that is safe to put into a GitHub comment: no notification for @mentions or team mentions. */
export function neutralizeMentions(text) {
  return String(text ?? '').replace(/(^|[^\w`])@(?=[A-Za-z0-9_])/g, `$1@${ZERO_WIDTH_SPACE}`);
}

/** Cuts a comment or issue body below GitHub's limit without splitting the hidden marker at the start. */
export function clampBody(text, max = MAX_BODY) {
  return text.length <= max ? text : `${text.slice(0, max - 40)}\n\n_Truncated: the report was too long._`;
}

/** Replaces the values of the named environment variables wherever they appear in a text that is about to be printed. */
export function redactValues(text, values) {
  return values
    .filter((value) => typeof value === 'string' && value.length >= 8)
    .reduce((out, value) => out.replaceAll(value, '***'), String(text ?? ''));
}

/** Deletes every bot comment with `marker` except the newest one and returns the ids it deleted. */
export async function pruneMarkedComments(github, issueNumber, marker) {
  const existing = (await github.paginate(`{repo}/issues/${issueNumber}/comments`)).filter(
    (comment) => comment.user?.type === 'Bot' && comment.body?.includes(marker),
  );
  const older = existing.slice(0, -1);
  for (const comment of older) await github.request('DELETE', `{repo}/issues/comments/${comment.id}`);
  return older.map((comment) => comment.id);
}

/**
 * Creates or updates the one comment that carries `marker` on an issue or pull request. Extra copies (a race, a manual
 * copy) are deleted so exactly one remains.
 */
export async function upsertMarkedComment(github, issueNumber, marker, body) {
  const route = `{repo}/issues/${issueNumber}/comments`;
  const existing = (await github.paginate(route)).filter((comment) => comment.body?.includes(marker));
  const [keep, ...extra] = existing;
  for (const duplicate of extra) await github.request('DELETE', `{repo}/issues/comments/${duplicate.id}`);
  if (keep) return github.request('PATCH', `{repo}/issues/comments/${keep.id}`, { body });
  return github.request('POST', route, { body });
}
