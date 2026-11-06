import { appendFileSync } from 'node:fs';
import { isMain } from './lib/util.mjs';

/**
 * Copies new unresolved Sentry issues into GitHub issues (run daily by .github/workflows/sentry-issues.yml).
 * Needs SENTRY_API_TOKEN (the personal token: organisation tokens cannot read issues), SENTRY_ORG, GITHUB_TOKEN and
 * GITHUB_REPOSITORY. An issue is created once per Sentry short id (the id is in the title), labelled `sentry`,
 * `type:bug` and `area:*`. The deliberate smoke errors of `pnpm telemetry:smoke` are skipped. Sentry text goes through
 * a scrubber before it reaches a public GitHub issue.
 *   node scripts/sentry-issues.mjs [--dry-run]
 */

const SENTRY_BASE = 'https://us.sentry.io/api/0';
const GITHUB_BASE = 'https://api.github.com';
const REQUEST_TIMEOUT_MS = 20_000;
const SMOKE_ERROR = 'HomestreamReadinessSmokeError';
const SHORT_ID = /\b[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-[A-Z0-9]+\b/;
const PROJECT_AREAS = [
  ['server', 'area:server'],
  ['web', 'area:web'],
  ['desktop', 'area:desktop'],
  ['tv', 'area:tv'],
];
const DEFAULT_AREA = 'area:server';
const MAX_TEXT = 600;

const SCRUBBERS = [
  [/https?:\/\/[^\s"'<>)]+/gi, '<url>'],
  [/\beyJ[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]+){0,2}/g, '<token>'],
  [/\b(?:sntry[su]|ph[cx])_[A-Za-z0-9+/=_-]{12,}/g, '<token>'],
  [/\b(Bearer)\s+[A-Za-z0-9._~+/=-]{6,}/gi, '$1 <token>'],
  [/\b(token|apikey|api_key|key|secret|password|authorization)=[^&\s"']+/gi, '$1=<redacted>'],
  [/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, '<ip>'],
];

export function scrub(text) {
  return SCRUBBERS.reduce((value, [pattern, replacement]) => value.replace(pattern, replacement), String(text ?? ''))
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_TEXT);
}

/** The deliberate error sent by `pnpm telemetry:smoke` and the readiness validators; it is never a bug to fix. */
export function isSmokeError(issue) {
  return [issue.title, issue.metadata?.type, issue.metadata?.value, issue.culprit].some((text) =>
    String(text ?? '').includes(SMOKE_ERROR),
  );
}

export function areaLabel(issue) {
  const slug = String(issue.project?.slug ?? '').toLowerCase();
  const match = PROJECT_AREAS.find(([name]) => slug.split(/[-_]/).includes(name));
  return match ? match[1] : DEFAULT_AREA;
}

export function issueTitle(issue) {
  return `[${issue.shortId}] ${scrub(issue.title).slice(0, 120)}`;
}

export function issueBody(issue) {
  const rows = [
    ['Sentry issue', issue.permalink],
    ['Project', issue.project?.slug],
    ['Level', issue.level],
    ['Events', issue.count],
    ['First seen', issue.firstSeen],
    ['Last seen', issue.lastSeen],
    ['Culprit', issue.culprit ? scrub(issue.culprit) : null],
  ];
  const lines = rows
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([label, value]) => `- **${label}:** ${value}`);
  return [
    `Created from Sentry issue ${issue.shortId} by the Sentry issues workflow.`,
    '',
    ...lines,
    '',
    `> ${scrub(issue.metadata?.value || issue.title)}`,
    '',
    'Triage with docs/runbooks/sentry-triage.md. Put `Fixes ' +
      issue.shortId +
      '` in the commit message that fixes it so Sentry resolves the issue on release.',
    '',
  ].join('\n');
}

/** Sentry short ids already used in the titles of GitHub issues. */
export function knownShortIds(githubIssues) {
  return new Set(
    githubIssues.flatMap((item) => {
      const match = /^\[([^\]]+)\]/.exec(item.title ?? '');
      return match && SHORT_ID.test(match[1]) ? [match[1]] : [];
    }),
  );
}

export function planIssues(sentryIssues, githubIssues) {
  const known = knownShortIds(githubIssues);
  const create = [];
  const skipped = { smoke: 0, duplicate: 0 };
  for (const issue of sentryIssues) {
    if (isSmokeError(issue)) skipped.smoke += 1;
    else if (known.has(issue.shortId)) skipped.duplicate += 1;
    else {
      known.add(issue.shortId);
      create.push({
        title: issueTitle(issue),
        body: issueBody(issue),
        labels: ['sentry', 'type:bug', areaLabel(issue)],
      });
    }
  }
  return { create, skipped };
}

async function request(fetchImpl, url, init) {
  const response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!response.ok) {
    const detail = (await response.text()).replace(/\s+/g, ' ').slice(0, 200);
    throw new Error(`${init.method ?? 'GET'} ${new URL(url).pathname} answered ${response.status}: ${detail}`);
  }
  return response.json();
}

export async function fetchSentryIssues({ token, organization, fetchImpl = fetch, base = SENTRY_BASE }) {
  const query = new URLSearchParams({ query: 'is:unresolved', statsPeriod: '14d', sort: 'new', limit: '100' });
  const issues = await request(fetchImpl, `${base}/organizations/${organization}/issues/?${query}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  return issues.filter((issue) => String(issue.project?.slug ?? '').startsWith('homestream'));
}

export async function fetchGithubIssues({ token, repository, fetchImpl = fetch, base = GITHUB_BASE }) {
  const all = [];
  for (let page = 1; page <= 10; page += 1) {
    const batch = await request(
      fetchImpl,
      `${base}/repos/${repository}/issues?labels=sentry&state=all&per_page=100&page=${page}`,
      {
        headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json' },
      },
    );
    all.push(...batch);
    if (batch.length < 100) break;
  }
  return all;
}

export async function createGithubIssue({ token, repository, issue, fetchImpl = fetch, base = GITHUB_BASE }) {
  return request(fetchImpl, `${base}/repos/${repository}/issues`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'content-type': 'application/json',
    },
    body: JSON.stringify(issue),
  });
}

export async function main(argv, env = process.env, fetchImpl = fetch) {
  const dryRun = argv.includes('--dry-run');
  const missing = ['SENTRY_API_TOKEN', 'SENTRY_ORG', 'GITHUB_TOKEN', 'GITHUB_REPOSITORY'].filter((name) => !env[name]);
  if (missing.length > 0) {
    console.error(`[sentry-issues] missing environment: ${missing.join(', ')}`);
    return 1;
  }
  const repository = env.GITHUB_REPOSITORY;
  const sentryIssues = await fetchSentryIssues({
    token: env.SENTRY_API_TOKEN,
    organization: env.SENTRY_ORG,
    fetchImpl,
  });
  const githubIssues = await fetchGithubIssues({ token: env.GITHUB_TOKEN, repository, fetchImpl });
  const { create, skipped } = planIssues(sentryIssues, githubIssues);
  const lines = [
    `Sentry issues: ${sentryIssues.length}`,
    `Skipped smoke errors: ${skipped.smoke}`,
    `Already on GitHub: ${skipped.duplicate}`,
  ];
  for (const issue of create) {
    if (!dryRun) await createGithubIssue({ token: env.GITHUB_TOKEN, repository, issue, fetchImpl });
    lines.push(`${dryRun ? 'Would create' : 'Created'}: ${issue.title}`);
  }
  console.log(lines.join('\n'));
  if (env.GITHUB_STEP_SUMMARY)
    appendFileSync(env.GITHUB_STEP_SUMMARY, `## Sentry issues\n\n${lines.map((line) => `- ${line}`).join('\n')}\n`);
  return 0;
}

if (isMain(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
      console.error(`[sentry-issues] ${error.message}`);
      process.exit(1);
    },
  );
}
