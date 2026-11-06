import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { anchorsOf, diagramProblems, linksOf, schemaDriftProblems, slugify } from '../../../../scripts/check-docs.mjs';
import { removeDir } from '../helpers.js';
import { makeTempRepo, runScript, writeAndStage } from './repoHelpers.js';

const realRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const roots: string[] = [];
let repo: string;

const DIAGRAMS = [
  'flowchart LR\n  A --> B',
  'sequenceDiagram\n  A->>B: hi',
  'erDiagram\n  A ||--o{ B : has',
  'graph TD\n  A-->B',
  'stateDiagram-v2\n  [*] --> A',
]
  .map((body) => `\`\`\`mermaid\n${body}\n\`\`\``)
  .join('\n\n');

beforeEach(() => {
  repo = makeTempRepo('docscheck');
  roots.push(repo);
  writeAndStage(repo, 'docs/architecture.md', `# Architecture\n\n## Data model\n\n${DIAGRAMS}\n`);
});
afterAll(() => {
  for (const dir of roots) removeDir(dir);
});

function check(readme: string) {
  mkdirSync(repo, { recursive: true });
  writeFileSync(path.join(repo, 'README.md'), readme);
  return runScript(repo, 'check-docs.mjs');
}

describe('check-docs', () => {
  it('passes when links and anchors resolve', () => {
    const result = check(
      '# Title\n\n## Quick start\n\nSee [arch](docs/architecture.md#data-model), [top](#quick-start), [web](https://example.com/x#y).\n',
    );
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });

  it('fails on a link to a file that does not exist', () => {
    const result = check('[gone](docs/gone.md)\n');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('README.md:1: broken link docs/gone.md');
  });

  it('fails on an anchor that is not a heading in the target file or in the same file', () => {
    expect(check('[x](docs/architecture.md#nope)\n').stderr).toContain('no heading for #nope');
    expect(check('# A\n\n[x](#missing)\n').stderr).toContain('no heading for #missing');
  });

  it('ignores links inside code', () => {
    expect(check('`[x](missing.md)`\n\n```\n[y](missing.md)\n```\n').status).toBe(0);
  });

  it('requires five valid mermaid diagrams in docs/architecture.md', () => {
    writeAndStage(repo, 'docs/architecture.md', '# Architecture\n\n```mermaid\nflowchart LR\n  A --> B\n```\n');
    const result = check('# R\n');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('has 1 mermaid diagrams, needs at least 5');
  });
});

describe('check-docs schema drift', () => {
  const SCHEMA = 'CREATE TABLE a (id TEXT);\nCREATE TABLE "b" (id TEXT);\nCREATE TABLE settings (key TEXT);\n';
  const diagram = (...entities: string[]) =>
    `\`\`\`mermaid\nerDiagram\n  a ||--o{ b : has\n${entities.map((name) => `  ${name} {\n    TEXT id PK\n  }`).join('\n')}\n\`\`\``;

  it('names a table that is missing from the erDiagram', () => {
    expect(schemaDriftProblems(diagram('a', 'b'), SCHEMA)).toEqual(['erDiagram is missing the table settings']);
  });

  it('names an entity that is not a table', () => {
    expect(schemaDriftProblems(diagram('a', 'b', 'settings', 'ghost'), SCHEMA)).toEqual([
      'erDiagram has ghost, which is not a table',
    ]);
  });

  it('passes when entities and tables match, ignoring relation lines', () => {
    expect(schemaDriftProblems(diagram('a', 'b', 'settings'), SCHEMA)).toEqual([]);
  });

  it('fails the script and names the missing table when docs/schema.sql has one more table', () => {
    writeAndStage(repo, 'docs/schema.sql', 'CREATE TABLE A (x TEXT);\nCREATE TABLE extra_table (x TEXT);\n');
    writeAndStage(
      repo,
      'docs/architecture.md',
      `# Architecture\n\n${DIAGRAMS.replace('A ||--o{ B : has', 'A ||--o{ B : has\n  A {\n    TEXT x\n  }')}\n`,
    );
    const result = check('# R\n');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('erDiagram is missing the table extra_table');
  });

  it('reports an unclosed code fence', () => {
    const result = check('# R\n\n```powershell\npnpm lint\n');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('README.md:3: unclosed code fence');
  });
});

describe('helpers', () => {
  it('slugifies headings like GitHub', () => {
    expect(slugify('Quick start')).toBe('quick-start');
    expect(slugify('`pnpm db:schema` & friends!')).toBe('pnpm-dbschema--friends');
  });

  it('drops HTML tags from headings, also nested ones', () => {
    expect(slugify('A <b>bold</b> word')).toBe('a-bold-word');
    expect(slugify('<scr<b>ipt>x')).toBe('iptx');
    expect(slugify('<<a>b>c')).toBe('bc');
  });

  it('numbers duplicate headings', () => {
    expect([...anchorsOf('# A\n\n## A\n')]).toEqual(['a', 'a-1']);
  });

  it('finds inline and reference links outside code', () => {
    const links = linksOf('[a](x.md) and ![i](img.png "t")\n[ref]: y.md\n`[c](z.md)`\n');
    expect(links.map((link) => link.target)).toEqual(['x.md', 'img.png', 'y.md']);
  });

  it('flags a diagram that does not start with a diagram keyword', () => {
    const problems = diagramProblems(`${DIAGRAMS}\n\n\`\`\`mermaid\nnot a diagram\n\`\`\`\n`);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('not a diagram keyword');
  });
});

describe('the repository', () => {
  it('has documentation whose relative links and anchors all resolve', () => {
    const result = runScript(realRoot, 'check-docs.mjs');
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });
});
