import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { removeDir } from '../helpers.js';
import { makeTempRepo, runScript, writeAndStage } from './repoHelpers.js';

const roots: string[] = [];
let repo: string;

beforeEach(() => {
  repo = makeTempRepo('techdebt');
  roots.push(repo);
  writeFileSync(path.join(repo, 'techdebt.config.json'), JSON.stringify({ budget: { TODO: 1, FIXME: 0, HACK: 0 } }));
});
afterAll(() => {
  for (const dir of roots) removeDir(dir);
});

describe('techdebt', () => {
  it('counts markers per package and passes within the budget', () => {
    writeAndStage(repo, 'apps/server/src/a.ts', '// TODO: later\nexport const a = 1;\n');
    writeAndStage(repo, 'packages/shared/src/b.ts', 'export const b = 2;\n');
    const result = runScript(repo, 'techdebt.mjs');
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/apps\/server\s+TODO 1\s+FIXME 0\s+HACK 0/);
    expect(result.stdout).toContain('TODO <= 1');
  });

  it('fails when a marker type goes over its budget', () => {
    writeAndStage(repo, 'apps/server/src/a.ts', '// TODO: one\n// TODO: two\n');
    writeAndStage(repo, 'apps/web/src/c.tsx', '// HACK: workaround\n');
    const result = runScript(repo, 'techdebt.mjs');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('TODO count 2 is over the budget of 1');
    expect(result.stderr).toContain('HACK count 1 is over the budget of 0');
  });

  it('counts files that are not staged yet', () => {
    writeAndStage(repo, 'apps/server/src/ok.ts', 'export const ok = 1;\n');
    writeFileSync(path.join(repo, 'new.ts'), '// FIXME: unstaged\n');
    expect(runScript(repo, 'techdebt.mjs').status).toBe(1);
  });
});
