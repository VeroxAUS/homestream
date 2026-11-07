import { appendFileSync, writeFileSync } from 'node:fs';
import { git, isMain, repoRoot } from './lib/util.mjs';

/**
 * Next release version from the Conventional Commits since the last `v*` tag, used by .github/workflows/release.yml.
 *   feat -> minor, fix and perf -> patch, `!` or a BREAKING CHANGE footer -> major,
 *   docs, chore, ci, test, style, refactor, build only -> no release. The first release is v0.1.0.
 *   node scripts/next-version.mjs --dry-run              print the plan for the local history, write nothing
 *   node scripts/next-version.mjs --sha <ref>            plan for the history up to <ref> (default HEAD)
 *   node scripts/next-version.mjs --notes-file <path>    also write the commit list as Markdown
 * With GITHUB_OUTPUT set (and no --dry-run) it writes `release`, `version`, `tag` and `previous` (the last tag, empty for the first release) for the workflow.
 */

export const FIRST_VERSION = '0.1.0';
const BUMP_ORDER = ['none', 'patch', 'minor', 'major'];
const TYPE_BUMPS = { feat: 'minor', fix: 'patch', perf: 'patch' };
const SUBJECT = /^(\w+)(?:\(([^)]*)\))?(!)?:\s*(.+)$/;
const BREAKING_FOOTER = /^BREAKING[ -]CHANGE:/m;
const NOTE_SECTIONS = [
  ['Breaking changes', (commit) => commit.breaking],
  ['Features', (commit) => commit.type === 'feat'],
  ['Fixes', (commit) => commit.type === 'fix'],
  ['Performance', (commit) => commit.type === 'perf'],
];

/** `{type, scope, breaking, description}` for a commit message, or null when it is not a Conventional Commit. */
export function parseCommit(subject, body = '') {
  const match = SUBJECT.exec(subject.trim());
  if (!match) return null;
  const [, type, scope = '', bang, description = ''] = match;
  return {
    type: type.toLowerCase(),
    scope,
    breaking: Boolean(bang) || BREAKING_FOOTER.test(body),
    description: description.trim(),
  };
}

export function bumpFor(commit) {
  if (!commit) return 'none';
  return commit.breaking ? 'major' : (TYPE_BUMPS[commit.type] ?? 'none');
}

export function highestBump(commits) {
  return commits
    .map(bumpFor)
    .reduce((best, bump) => (BUMP_ORDER.indexOf(bump) > BUMP_ORDER.indexOf(best) ? bump : best), 'none');
}

export function applyBump(version, bump) {
  const [major, minor, patch] = version.split('.').map(Number);
  if (bump === 'major') return `${major + 1}.0.0`;
  if (bump === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

/**
 * Plan for the commits since `lastTag` (null when no release exists yet).
 * `commits` are `{sha, subject, body}` objects, newest first.
 */
export function planRelease(lastTag, commits) {
  const parsed = commits.map((commit) => ({ ...commit, parsed: parseCommit(commit.subject, commit.body) }));
  if (!lastTag) {
    return { release: parsed.length > 0, bump: 'initial', version: FIRST_VERSION, previous: null, commits: parsed };
  }
  const previous = lastTag.replace(/^v/, '');
  const bump = highestBump(parsed.map((commit) => commit.parsed));
  const release = bump !== 'none';
  return { release, bump, version: release ? applyBump(previous, bump) : previous, previous, commits: parsed };
}

/** Release-note section listing the commits that triggered the release; GitHub's generated notes follow it. */
export function formatCommitNotes(plan) {
  const lines = [];
  for (const [title, matches] of NOTE_SECTIONS) {
    const section = plan.commits.filter((commit) => commit.parsed && matches(commit.parsed));
    if (section.length === 0) continue;
    lines.push(`### ${title}`, '');
    for (const commit of section) {
      const scope = commit.parsed.scope ? `**${commit.parsed.scope}:** ` : '';
      lines.push(`- ${scope}${commit.parsed.description} (${commit.sha.slice(0, 7)})`);
    }
    lines.push('');
  }
  const other =
    plan.commits.length -
    plan.commits.filter((commit) => commit.parsed && NOTE_SECTIONS.some(([, m]) => m(commit.parsed))).length;
  if (other > 0)
    lines.push(`Plus ${other} maintenance commit${other === 1 ? '' : 's'} (docs, chore, ci, test, refactor).`, '');
  return lines.join('\n');
}

export function lastReleaseTag(sha, cwd) {
  const tags = git(['tag', '--list', 'v[0-9]*', '--merged', sha, '--sort=-v:refname'], { cwd })
    .split('\n')
    .filter(Boolean);
  return tags[0] ?? null;
}

/** True when a release tag already contains the commit: runs on main may finish out of order, a newer one released first. */
function coveredByRelease(sha, cwd) {
  return git(['tag', '--list', 'v[0-9]*', '--contains', sha], { cwd }).trim() !== '';
}

export function commitsSince(lastTag, sha, cwd) {
  const range = lastTag ? `${lastTag}..${sha}` : sha;
  const raw = git(['log', '--format=%H%x1f%s%x1f%b%x1e', range], { cwd });
  return raw
    .split('\x1e')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [hash = '', subject = '', body = ''] = entry.split('\x1f');
      return { sha: hash, subject, body };
    });
}

export function parseArgs(argv) {
  const options = { dryRun: false, json: false, sha: 'HEAD', notesFile: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--sha') options.sha = argv[++i];
    else if (arg === '--notes-file') options.notesFile = argv[++i];
    else return null;
  }
  return options.sha && options.notesFile !== undefined ? options : null;
}

export function main(argv, cwd = repoRoot(), env = process.env) {
  const options = parseArgs(argv);
  if (!options) {
    console.error('Usage: node scripts/next-version.mjs [--dry-run] [--json] [--sha <ref>] [--notes-file <path>]');
    return 2;
  }
  const lastTag = lastReleaseTag(options.sha, cwd);
  const plan = planRelease(lastTag, commitsSince(lastTag, options.sha, cwd));
  if (coveredByRelease(options.sha, cwd)) plan.release = false;
  const tag = `v${plan.version}`;
  if (options.notesFile) writeFileSync(options.notesFile, formatCommitNotes(plan));
  if (options.json) {
    console.log(
      JSON.stringify({
        release: plan.release,
        bump: plan.bump,
        version: plan.version,
        tag,
        previous: lastTag,
        commits: plan.commits.length,
      }),
    );
  } else {
    console.log(`Last release: ${lastTag ?? 'none'}`);
    console.log(`Commits since: ${plan.commits.length}`);
    console.log(
      plan.release
        ? `Next release: ${tag} (${plan.bump})`
        : 'No release: only docs, chore, ci, test or refactor commits since the last release.',
    );
  }
  if (!options.dryRun && env.GITHUB_OUTPUT) {
    appendFileSync(
      env.GITHUB_OUTPUT,
      `release=${plan.release}\nversion=${plan.version}\ntag=${tag}\nprevious=${lastTag ?? ''}\n`,
    );
  }
  return 0;
}

if (isMain(import.meta.url)) process.exit(main(process.argv.slice(2)));
