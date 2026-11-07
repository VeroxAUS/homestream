import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { removeDir } from '../helpers.js';
import { makeTempRepo, runScript, writeAndStage } from './repoHelpers.js';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const roots: string[] = [];
let repo: string;

const source = (count: number) =>
  Array.from({ length: count }, (_, i) => `export const v${i} = ${i};`).join('\n') + '\n';
const baseline = (files: Record<string, { lines?: number; functionLines?: number }>) =>
  JSON.stringify({ files }) + '\n';

function commit(message: string): void {
  execFileSync('git', ['-c', 'commit.gpgsign=false', 'commit', '-q', '-m', message], {
    cwd: repo,
    stdio: 'ignore',
    windowsHide: true,
  });
}

function check() {
  return runScript(repo, 'code-limits.mjs');
}

beforeEach(() => {
  repo = makeTempRepo('code-limits');
  roots.push(repo);
  writeAndStage(repo, 'apps/server/src/big.ts', source(450));
  writeAndStage(repo, 'code-limits.baseline.json', baseline({ 'apps/server/src/big.ts': { lines: 450 } }));
  writeAndStage(repo, 'README.md', 'first\n');
  commit('baseline');
  writeAndStage(repo, 'README.md', 'second\n');
  commit('next');
});
afterAll(() => {
  for (const dir of roots) removeDir(dir);
});

describe('code-limits ratchet', () => {
  it('passes when ceilings equal the measured sizes', () => {
    const result = check();
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('ok, 1 baselined files');
  });

  it('fails when a file shrank but its ceiling did not follow', () => {
    writeAndStage(repo, 'apps/server/src/big.ts', source(420));
    const result = check();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('lines ceiling 450 is above the measured 420');
  });

  it('fails when an entry is no longer needed because the file is within the limit', () => {
    writeAndStage(repo, 'apps/server/src/big.ts', source(380));
    const result = check();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('lines is 380, within the limit of 400');
  });

  it('fails when a file grew past its ceiling', () => {
    writeAndStage(repo, 'apps/server/src/big.ts', source(460));
    const result = check();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('lines is 460, over its ceiling of 450');
  });

  it('fails when a ceiling is raised compared with the previous commit', () => {
    writeAndStage(repo, 'apps/server/src/big.ts', source(470));
    writeAndStage(repo, 'code-limits.baseline.json', baseline({ 'apps/server/src/big.ts': { lines: 470 } }));
    const result = check();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('lines ceiling raised from 450 to 470');
  });

  it('fails when an entry is added compared with the previous commit', () => {
    writeAndStage(repo, 'apps/server/src/other.ts', source(401));
    writeAndStage(
      repo,
      'code-limits.baseline.json',
      baseline({ 'apps/server/src/big.ts': { lines: 450 }, 'apps/server/src/other.ts': { lines: 401 } }),
    );
    const result = check();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('other.ts: new lines ceiling 401');
  });

  it('fails for an entry whose file is gone', () => {
    writeAndStage(
      repo,
      'code-limits.baseline.json',
      baseline({ 'apps/server/src/big.ts': { lines: 450 }, 'apps/server/src/gone.ts': { lines: 500 } }),
    );
    const result = check();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('gone.ts: listed in code-limits.baseline.json but the file does not exist');
  });

  it('--write lowers ceilings and never raises them', () => {
    writeAndStage(repo, 'apps/server/src/big.ts', source(420));
    expect(runScript(repo, 'code-limits.mjs', ['--write']).status).toBe(0);
    expect(check().status).toBe(0);
    writeAndStage(repo, 'apps/server/src/big.ts', source(500));
    expect(runScript(repo, 'code-limits.mjs', ['--write']).status).toBe(0);
    const result = check();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('lines is 500, over its ceiling of 420');
  });
});

describe('line limits in the ESLint config', () => {
  const lint = async (filePath: string, text: string) => {
    const eslint = new ESLint({ cwd: repoRoot });
    const [result] = await eslint.lintText(text, { filePath: `${repoRoot}${filePath}` });
    return result?.messages.filter((m) => m.ruleId === 'max-lines' || m.ruleId === 'max-lines-per-function') ?? [];
  };

  it('rejects a new file over 400 lines', async () => {
    const messages = await lint('apps/server/src/newFileOverLimit.ts', source(401));
    expect(messages.map((m) => m.ruleId)).toEqual(['max-lines']);
  });

  it('accepts a new file of exactly 400 counted lines, ignoring blanks and comments', async () => {
    const padded = `// header\n\n${source(400)}\n// trailer\n`;
    expect(await lint('apps/server/src/newFileAtLimit.ts', padded)).toEqual([]);
  });

  it('rejects a new function over 80 lines', async () => {
    const body = Array.from({ length: 81 }, (_, i) => `  total += ${i};`).join('\n');
    const text = `export function tooLong(): number {\n  let total = 0;\n${body}\n  return total;\n}\n`;
    const messages = await lint('apps/server/src/newFunctionOverLimit.ts', text);
    expect(messages.map((m) => m.ruleId)).toEqual(['max-lines-per-function']);
  });

  it('does not apply the function limit to test callbacks', async () => {
    const body = Array.from({ length: 90 }, (_, i) => `  expect(${i}).toBe(${i});`).join('\n');
    const text = `describe('x', () => {\n${body}\n});\n`;
    expect(await lint('apps/server/test/newSuite.test.ts', text)).toEqual([]);
  });
});
