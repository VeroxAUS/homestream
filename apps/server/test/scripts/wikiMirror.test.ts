import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { afterAll, describe, expect, it } from 'vitest';
import { mirrorWiki } from '../../../../scripts/wiki-mirror.mjs';
import { makeTempDir, removeDir } from '../helpers.js';
import { makeTempRepo } from './repoHelpers.js';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const dirs: string[] = [];

interface Step {
  name?: string;
  uses?: string;
  run?: string;
  with?: Record<string, string>;
}

function publishSteps(): Step[] {
  const text = readFileSync(path.join(repoRoot, '.github', 'workflows', 'droid-wiki-refresh.yml'), 'utf8');
  const workflow = parse(text) as { jobs: Record<string, { steps: Step[] }> };
  return workflow.jobs['wiki-publish']?.steps ?? [];
}

function write(root: string, files: Record<string, string>): void {
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), content);
  }
}

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true }).trimEnd();

afterAll(() => {
  for (const dir of dirs) removeDir(dir);
});

describe('wiki publish copy step', () => {
  it('turns pages the generator removed into committed deletions and keeps video and images out of git', () => {
    const repo = makeTempRepo('wiki-mirror');
    const artifact = makeTempDir('wiki-artifact');
    dirs.push(repo, artifact);
    write(repo, {
      'droid-wiki/.wiki-meta.json': '{"sha":"old"}',
      'droid-wiki/overview/index.md': 'old overview',
      'droid-wiki/how-to-monitor.md': 'dropped page',
      'droid-wiki/how-to-monitor/index.md': 'kept page',
      'droid-wiki/systems/old-system.md': 'dropped nested page',
      'droid-wiki/unrelated.md': 'unchanged',
    });
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'baseline');
    write(repo, { 'droid-wiki/video/overview.mp4': 'local only', 'droid-wiki/images/shot.png': 'local only' });

    write(artifact, {
      '.wiki-meta.json': '{"sha":"new"}',
      'overview/index.md': 'new overview',
      'how-to-monitor/index.md': 'kept page',
      'unrelated.md': 'unchanged',
      'systems/new-system.md': 'new nested page',
    });

    const addPaths = publishSteps()
      .find((step) => step.uses?.includes('create-pull-request'))
      ?.with?.['add-paths']?.split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    expect(addPaths).toContain('droid-wiki/**');

    const mirror = spawnSync(
      process.execPath,
      [path.join(repoRoot, 'scripts', 'wiki-mirror.mjs'), artifact, path.join(repo, 'droid-wiki')],
      { encoding: 'utf8', windowsHide: true },
    );
    expect(mirror.status, mirror.stderr).toBe(0);

    git(repo, 'add', '--', ...(addPaths ?? []));
    const staged = git(repo, 'diff', '--cached', '--name-status')
      .split('\n')
      .map((line) => line.replace(/\s+/g, ' '))
      .sort();
    expect(staged).toEqual([
      'A droid-wiki/systems/new-system.md',
      'D droid-wiki/how-to-monitor.md',
      'D droid-wiki/systems/old-system.md',
      'M droid-wiki/.wiki-meta.json',
      'M droid-wiki/overview/index.md',
    ]);
    expect(existsSync(path.join(repo, 'droid-wiki', 'how-to-monitor.md'))).toBe(false);
    expect(readFileSync(path.join(repo, 'droid-wiki', '.wiki-meta.json'), 'utf8')).toContain('new');
    expect(existsSync(path.join(repo, 'droid-wiki', 'video', 'overview.mp4'))).toBe(true);
    expect(existsSync(path.join(repo, 'droid-wiki', 'images', 'shot.png'))).toBe(true);
    expect(git(repo, 'ls-files', 'droid-wiki/video', 'droid-wiki/images')).toBe('');
  });

  it('refuses an artifact that is not a wiki instead of emptying the folder', () => {
    const wiki = makeTempDir('wiki-keep');
    const artifact = makeTempDir('wiki-empty');
    dirs.push(wiki, artifact);
    write(wiki, { 'page.md': 'keep me' });
    expect(() => mirrorWiki(artifact, wiki)).toThrow('has no .wiki-meta.json');
    expect(existsSync(path.join(wiki, 'page.md'))).toBe(true);
  });

  it('runs in the publish job after the download and before the pull request, from the downloaded folder', () => {
    const steps = publishSteps();
    const download = steps.findIndex((step) => step.uses?.includes('download-artifact'));
    const mirror = steps.findIndex((step) => step.run?.includes('scripts/wiki-mirror.mjs'));
    const pullRequest = steps.findIndex((step) => step.uses?.includes('create-pull-request'));
    expect(download).toBeGreaterThanOrEqual(0);
    expect(mirror).toBeGreaterThan(download);
    expect(pullRequest).toBeGreaterThan(mirror);
    expect(steps[download]?.with?.path).not.toBe('droid-wiki');
  });
});
