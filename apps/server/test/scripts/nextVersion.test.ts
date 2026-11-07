import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  applyBump,
  bumpFor,
  formatCommitNotes,
  highestBump,
  parseCommit,
  planRelease,
  type RawCommit,
} from '../../../../scripts/next-version.mjs';
import { makeTempDir, removeDir } from '../helpers.js';
import { makeTempRepo, runScript } from './repoHelpers.js';

const commit = (subject: string, body = ''): RawCommit => ({ sha: 'a'.repeat(40), subject, body });

describe('parseCommit and bumpFor', () => {
  it.each([
    ['feat(server): add thing', 'minor'],
    ['feat: add thing', 'minor'],
    ['fix(web): repair thing', 'patch'],
    ['perf(server): faster', 'patch'],
    ['feat(api)!: drop v1', 'major'],
    ['fix!: change the default', 'major'],
    ['docs: update readme', 'none'],
    ['chore(deps): bump x', 'none'],
    ['ci: tweak workflow', 'none'],
    ['test: more tests', 'none'],
    ['refactor: tidy', 'none'],
    ['Merge branch main', 'none'],
  ])('%s -> %s', (subject, expected) => {
    expect(bumpFor(parseCommit(subject))).toBe(expected);
  });

  it('treats a BREAKING CHANGE footer as major, whatever the type', () => {
    expect(bumpFor(parseCommit('docs: rewrite', 'Details.\n\nBREAKING CHANGE: config format changed'))).toBe('major');
    expect(bumpFor(parseCommit('fix: x', 'BREAKING-CHANGE: y'))).toBe('major');
  });

  it('does not see a breaking change in prose that merely mentions it', () => {
    expect(bumpFor(parseCommit('fix: x', 'this is not a BREAKING CHANGE: in a footer position'))).toBe('patch');
  });
});

describe('highestBump and applyBump', () => {
  it('takes the highest bump of the range', () => {
    const parsed = ['fix: a', 'feat: b', 'docs: c'].map((subject) => parseCommit(subject));
    expect(highestBump(parsed)).toBe('minor');
    expect(highestBump([parseCommit('fix: a'), parseCommit('feat!: b')])).toBe('major');
    expect(highestBump([parseCommit('docs: a'), null])).toBe('none');
  });

  it.each([
    ['0.1.0', 'patch', '0.1.1'],
    ['0.1.5', 'minor', '0.2.0'],
    ['0.9.3', 'major', '1.0.0'],
    ['1.2.3', 'minor', '1.3.0'],
  ] as const)('%s + %s = %s', (version, bump, expected) => {
    expect(applyBump(version, bump)).toBe(expected);
  });
});

describe('planRelease', () => {
  it('cuts v0.1.0 as the first release, whatever the commit types', () => {
    const plan = planRelease(null, [commit('docs: first'), commit('chore: init')]);
    expect(plan).toMatchObject({ release: true, version: '0.1.0', previous: null });
  });

  it('does not release an empty first range', () => {
    expect(planRelease(null, []).release).toBe(false);
  });

  it('bumps from the last tag by the highest commit', () => {
    expect(planRelease('v0.1.0', [commit('fix: a'), commit('docs: b')])).toMatchObject({
      release: true,
      version: '0.1.1',
      bump: 'patch',
    });
    expect(planRelease('v0.1.1', [commit('feat(web): a'), commit('fix: b')])).toMatchObject({
      release: true,
      version: '0.2.0',
      bump: 'minor',
    });
    expect(planRelease('v0.2.0', [commit('feat!: a')])).toMatchObject({
      release: true,
      version: '1.0.0',
      bump: 'major',
    });
  });

  it('makes no release for docs, chore, ci and test commits only', () => {
    const plan = planRelease('v0.3.0', [commit('docs: a'), commit('chore: b'), commit('ci: c'), commit('test: d')]);
    expect(plan).toMatchObject({ release: false, bump: 'none', version: '0.3.0' });
  });
});

describe('formatCommitNotes', () => {
  it('lists features, fixes and breaking changes with short hashes and counts the rest', () => {
    const plan = planRelease('v0.1.0', [
      commit('feat(server): add metrics'),
      commit('fix(web): focus ring'),
      commit('feat(api)!: new shape'),
      commit('docs: words'),
    ]);
    const notes = formatCommitNotes(plan);
    expect(notes).toContain('### Breaking changes');
    expect(notes).toContain('- **api:** new shape (aaaaaaa)');
    expect(notes).toContain('### Features');
    expect(notes).toContain('### Fixes');
    expect(notes).toContain('Plus 1 maintenance commit');
  });
});

describe('next-version.mjs --dry-run', () => {
  const roots: string[] = [];
  afterAll(() => {
    for (const dir of roots) removeDir(dir);
  });

  function commitFile(repo: string, message: string): void {
    execFileSync('git', ['commit', '--allow-empty', '-q', '-m', message], { cwd: repo, windowsHide: true });
  }

  it('prints v0.1.0 for a repository without tags and the next version after a tag, and writes nothing', () => {
    const repo = makeTempRepo('nextversion');
    roots.push(repo);
    commitFile(repo, 'chore: init');
    const first = runScript(repo, 'next-version.mjs', ['--dry-run']);
    expect(first.status).toBe(0);
    expect(first.stdout).toContain('Next release: v0.1.0');

    execFileSync('git', ['tag', 'v0.1.0'], { cwd: repo, windowsHide: true });
    commitFile(repo, 'docs: words');
    expect(runScript(repo, 'next-version.mjs', ['--dry-run']).stdout).toContain('No release');

    commitFile(repo, 'feat(server): new thing');
    const notesFile = path.join(makeTempDir('nextversion-notes'), 'notes.md');
    roots.push(path.dirname(notesFile));
    const output = path.join(path.dirname(notesFile), 'github-output');
    const json = runScript(repo, 'next-version.mjs', ['--dry-run', '--json', '--notes-file', notesFile], {
      GITHUB_OUTPUT: output,
    });
    expect(JSON.parse(json.stdout)).toMatchObject({
      release: true,
      version: '0.2.0',
      tag: 'v0.2.0',
      previous: 'v0.1.0',
      commits: 2,
    });
    expect(readFileSync(notesFile, 'utf8')).toContain('- **server:** new thing');
    expect(() => readFileSync(output, 'utf8')).toThrow();

    const real = runScript(repo, 'next-version.mjs', [], { GITHUB_OUTPUT: output });
    expect(real.status).toBe(0);
    expect(readFileSync(output, 'utf8')).toBe('release=true\nversion=0.2.0\ntag=v0.2.0\nprevious=v0.1.0\n');
  });

  it('makes no release for a commit that a later release tag already covers (CI runs on main finish out of order)', () => {
    const repo = makeTempRepo('nextversion-late');
    roots.push(repo);
    commitFile(repo, 'chore: init');
    execFileSync('git', ['tag', 'v0.1.0'], { cwd: repo, windowsHide: true });
    commitFile(repo, 'fix: first');
    const older = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, windowsHide: true, encoding: 'utf8' }).trim();
    commitFile(repo, 'fix: second');
    execFileSync('git', ['tag', 'v0.1.1'], { cwd: repo, windowsHide: true });

    const late = runScript(repo, 'next-version.mjs', ['--dry-run', '--json', '--sha', older]);
    expect(JSON.parse(late.stdout)).toMatchObject({ release: false });
    const output = path.join(makeTempDir('nextversion-late-out'), 'github-output');
    roots.push(path.dirname(output));
    runScript(repo, 'next-version.mjs', ['--sha', older], { GITHUB_OUTPUT: output });
    expect(readFileSync(output, 'utf8')).toContain('release=false\n');
  });

  it('rejects unknown arguments', () => {
    const repo = makeTempRepo('nextversion-args');
    roots.push(repo);
    expect(runScript(repo, 'next-version.mjs', ['--bogus']).status).toBe(2);
  });
});
