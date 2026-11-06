import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { checkPnpmCommand, missingHeadings, pnpmCommands } from '../../../../scripts/validate-agents-md.mjs';
import { removeDir } from '../helpers.js';
import { makeTempRepo, runScript, writeAndStage } from './repoHelpers.js';

const realRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const roots: string[] = [];
let repo: string;

const HEADINGS = [
  '# Project layout',
  '## Commands',
  '## Conventions',
  '## Testing',
  '## Telemetry rules',
  '## PowerShell 5.1 notes',
  '## Skills and runbooks',
  '## New app readiness checklist',
  '## CI checks',
].join('\n\n');

function agentsMd(extra: string): string {
  return `${HEADINGS}\n\n${extra}\n`;
}

function setup(): string {
  const dir = makeTempRepo('agentsmd');
  roots.push(dir);
  writeAndStage(dir, 'package.json', JSON.stringify({ name: 'root', scripts: { lint: 'x', 'test:unit': 'x' } }));
  writeAndStage(
    dir,
    'apps/server/package.json',
    JSON.stringify({ name: '@homestream/server', scripts: { test: 'x', build: 'x' } }),
  );
  writeAndStage(dir, 'scripts/ok.mjs', '');
  writeAndStage(dir, 'docs/openapi.json', JSON.stringify({ paths: { '/api/home': {}, '/api/movie/{tmdbId}': {} } }));
  mkdirSync(path.join(dir, 'docs'), { recursive: true });
  return dir;
}

function check(content: string) {
  writeFileSync(path.join(repo, 'AGENTS.md'), content);
  return runScript(repo, 'validate-agents-md.mjs');
}

beforeEach(() => {
  repo = setup();
});
afterAll(() => {
  for (const dir of roots) removeDir(dir);
});

describe('validate-agents-md', () => {
  it('passes when commands, paths and endpoints are real', () => {
    const result = check(
      agentsMd(
        [
          '```powershell',
          'pnpm lint; pnpm test:unit',
          'pnpm --filter @homestream/server test',
          'pnpm -r run build',
          'pnpm install --frozen-lockfile',
          'node scripts/ok.mjs',
          '```',
          'See `apps/server/package.json`, `GET /api/home` and `/api/movie/278`.',
        ].join('\n'),
      ),
    );
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });

  it('fails on a pnpm script that does not exist', () => {
    const result = check(agentsMd('```\npnpm does-not-exist\n```'));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('does-not-exist');
  });

  it('keeps a four-backtick block that contains a three-backtick line as one block', () => {
    const result = check(agentsMd('````powershell\npnpm lint\n```\npnpm does-not-exist\n````'));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('does-not-exist');
  });

  it('does not treat "```n" as a closing fence, and reports the unclosed fence', () => {
    const result = check(agentsMd('```powershell\npnpm lint\n```n\nProse paragraph.'));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('AGENTS.md:');
    expect(result.stderr).toContain('unclosed code fence');
  });

  it('checks a powershell block appended after the shape of the former broken AGENTS.md', () => {
    const fixed = agentsMd(
      ['```powershell', 'pnpm lint', '```', '', 'Prose paragraph.', '', '```powershell', 'pnpm test:unit', '```'].join(
        '\n',
      ),
    );
    expect(check(fixed).status).toBe(0);
    const result = check(`${fixed}\n\`\`\`powershell\npnpm does-not-exist\n\`\`\`\n`);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('does-not-exist');
  });

  it('fails on a filtered script that is not defined in that package', () => {
    const result = check(agentsMd('```\npnpm --filter @homestream/server lint\n```'));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('lint');
  });

  it('fails on a filter that matches no package', () => {
    expect(check(agentsMd('```\npnpm --filter @homestream/nope test\n```')).status).toBe(1);
  });

  it('fails on a referenced file that does not exist', () => {
    const result = check(agentsMd('```\nnode scripts/missing.mjs\n```'));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('scripts/missing.mjs');
  });

  it('fails on a missing path in inline code but ignores generated output and placeholders', () => {
    expect(check(agentsMd('Edit `docs/nope.md`.')).status).toBe(1);
    expect(check(agentsMd('Open `apps/web/dist/index.html`, `docs/<name>.md` and `scripts/*.mjs`.')).status).toBe(0);
  });

  it('fails on an endpoint that is not in docs/openapi.json', () => {
    const result = check(agentsMd('Call `/api/nope`.'));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('/api/nope');
  });

  it('fails when a required section is missing', () => {
    const result = check(HEADINGS.replace('## Telemetry rules', '## Other') + '\n');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('telemetry rules');
  });

  it('checks the repository skills and runbooks too', () => {
    writeAndStage(repo, '.factory/skills/demo/SKILL.md', '---\nname: demo\n---\n```\npnpm nope\n```\n');
    const result = check(agentsMd(''));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('.factory/skills/demo/SKILL.md');
  });
});

describe('helpers', () => {
  const context = {
    rootScripts: new Set(['lint']),
    packages: [{ name: '@homestream/web', scripts: { dev: 'x' } }],
  };

  it('splits command lines and drops prompts and comments', () => {
    expect(pnpmCommands('PS> pnpm lint; node x.mjs && pnpm build # note')).toEqual(['pnpm lint', 'pnpm build']);
    expect(pnpmCommands('# pnpm nope')).toEqual([]);
  });

  it('resolves built-ins, run, recursive and filtered commands', () => {
    expect(checkPnpmCommand('pnpm add -D x', context)).toBeNull();
    expect(checkPnpmCommand('pnpm run lint', context)).toBeNull();
    expect(checkPnpmCommand('pnpm -r dev', context)).toBeNull();
    expect(checkPnpmCommand('pnpm --filter @homestream/* dev', context)).toBeNull();
    expect(checkPnpmCommand('pnpm -r nope', context)).toMatch(/nope/);
  });

  it('lists the sections AGENTS.md lacks', () => {
    expect(missingHeadings('# Layout\n## Commands\n')).toContain('telemetry rules');
  });
});

describe('the repository', () => {
  it('has an AGENTS.md whose commands, paths and endpoints all resolve', () => {
    const result = runScript(realRoot, 'validate-agents-md.mjs');
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });
});
