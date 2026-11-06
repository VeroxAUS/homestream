import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fenceProblems, fencedBlocks, scanFences } from './lib/markdown.mjs';
import { git, isMain, repoRoot, splitNul } from './lib/util.mjs';

/**
 * Checks the markdown documentation: every code fence is closed, every relative link points at an existing file, every
 * `#anchor` matches a heading in the target file, and docs/architecture.md has its mermaid diagrams, with an erDiagram
 * entity for each table in docs/schema.sql. `pnpm docs:check`.
 */

/** Generated or vendored markdown that is not hand-maintained. */
const SKIP = [/^droid-wiki\//, /^\.planning-research\//, /^\.factory\/video\//, /(^|\/)node_modules\//];
export const MIN_DIAGRAMS = 5;
export const DIAGRAM_KEYWORDS = [
  'flowchart',
  'graph',
  'sequenceDiagram',
  'erDiagram',
  'stateDiagram-v2',
  'classDiagram',
  'gantt',
  'journey',
];

/** GitHub's heading id: lower case, punctuation removed, spaces to hyphens. */
export function slugify(heading) {
  return stripTags(heading.trim().toLowerCase())
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');
}

/** Repeats until stable so that nested input such as `<<b>b>` cannot leave a tag behind. */
function stripTags(text) {
  let current = text;
  for (let previous = ''; previous !== current;) {
    previous = current;
    current = current.replace(/<[^>]+>/g, '');
  }
  return current;
}

/** Lines outside fenced code blocks, with their 1-based numbers. */
function proseLines(markdown) {
  return scanFences(markdown)
    .lines.filter((entry) => entry.kind === 'prose')
    .map(({ line, text }) => ({ line, text }));
}

export function anchorsOf(markdown) {
  const seen = new Map();
  const anchors = new Set();
  for (const { text } of proseLines(markdown)) {
    const match = /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(text);
    if (!match) continue;
    const base = slugify(match[1].replace(/`/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1'));
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    anchors.add(count === 0 ? base : `${base}-${count}`);
  }
  return anchors;
}

/** `{line, target}` for each markdown link, reference definition and image in prose (not code). */
export function linksOf(markdown) {
  const links = [];
  for (const { line, text } of proseLines(markdown)) {
    const withoutCode = text.replace(/`[^`]*`/g, '');
    for (const match of withoutCode.matchAll(/!?\[[^\]]*\]\(\s*(<[^>]+>|[^)\s]+)(?:\s+"[^"]*")?\s*\)/g)) {
      links.push({ line, target: match[1].replace(/^<|>$/g, '') });
    }
    const definition = /^\s*\[[^\]]+\]:\s*(\S+)/.exec(withoutCode);
    if (definition) links.push({ line, target: definition[1] });
  }
  return links;
}

function isExternal(target) {
  return /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('//');
}

export function mermaidBlocks(markdown) {
  return fencedBlocks(markdown)
    .filter((block) => block.lang === 'mermaid')
    .map((block) => block.lines.join('\n'));
}

/** Names of the `CREATE TABLE` statements in a SQL dump, without quotes. */
function tableNames(sql) {
  return new Set(
    [...sql.matchAll(/^\s*CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["`[]?(\w+)/gim)].map((match) => match[1]),
  );
}

/** Entity names declared in the `erDiagram` blocks (`name {`), as opposed to relation lines. */
function erEntities(markdown) {
  const names = new Set();
  for (const block of mermaidBlocks(markdown)) {
    if (!/^\s*erDiagram\b/m.test(block)) continue;
    for (const match of block.matchAll(/^\s+(\w+)\s*\{/gm)) names.add(match[1]);
  }
  return names;
}

/** Tables that docs/schema.sql has but the erDiagram lacks, and entities that name no table. */
export function schemaDriftProblems(markdown, schemaSql) {
  const tables = tableNames(schemaSql);
  const entities = erEntities(markdown);
  return [
    ...[...tables].filter((name) => !entities.has(name)).map((name) => `erDiagram is missing the table ${name}`),
    ...[...entities].filter((name) => !tables.has(name)).map((name) => `erDiagram has ${name}, which is not a table`),
  ];
}

export function diagramProblems(markdown) {
  const blocks = mermaidBlocks(markdown);
  const problems = [];
  if (blocks.length < MIN_DIAGRAMS)
    problems.push(`has ${blocks.length} mermaid diagrams, needs at least ${MIN_DIAGRAMS}`);
  blocks.forEach((block, index) => {
    const first =
      block
        .split('\n')
        .find((line) => line.trim() && !line.trim().startsWith('%%'))
        ?.trim() ?? '';
    if (!DIAGRAM_KEYWORDS.some((keyword) => first === keyword || first.startsWith(`${keyword} `))) {
      problems.push(`mermaid diagram ${index + 1} starts with "${first.slice(0, 30)}", not a diagram keyword`);
    }
  });
  return problems;
}

export function checkFile(file, markdown, root, readTarget = (target) => readFileSync(target, 'utf8')) {
  const problems = fenceProblems(file, markdown);
  const here = path.dirname(path.join(root, file));
  const ownAnchors = anchorsOf(markdown);
  for (const { line, target } of linksOf(markdown)) {
    if (isExternal(target)) continue;
    const [rawPath = '', fragment] = target.split('#');
    const anchor = fragment === undefined ? undefined : decodeURIComponent(fragment).toLowerCase();
    if (rawPath === '') {
      if (anchor !== undefined && anchor !== '' && !ownAnchors.has(anchor)) {
        problems.push(`${file}:${line}: no heading for #${anchor}`);
      }
      continue;
    }
    const resolved = path.resolve(here, decodeURIComponent(rawPath.split('?')[0]));
    const outside = path.relative(path.resolve(root), resolved).startsWith('..');
    if (outside || !existsSync(resolved)) {
      problems.push(`${file}:${line}: broken link ${target}`);
      continue;
    }
    if (
      anchor &&
      resolved.endsWith('.md') &&
      statSync(resolved).isFile() &&
      !anchorsOf(readTarget(resolved)).has(anchor)
    ) {
      problems.push(`${file}:${line}: ${rawPath} has no heading for #${anchor}`);
    }
  }
  return problems;
}

export function main(root = repoRoot()) {
  const files = splitNul(git(['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root }))
    .filter((file) => file.endsWith('.md') && !SKIP.some((pattern) => pattern.test(file)))
    .filter((file) => existsSync(path.join(root, file)));
  const problems = [];
  for (const file of files) {
    const markdown = readFileSync(path.join(root, file), 'utf8');
    problems.push(...checkFile(file, markdown, root));
    if (file === 'docs/architecture.md') {
      problems.push(...diagramProblems(markdown).map((p) => `${file}: ${p}`));
      const schema = path.join(root, 'docs', 'schema.sql');
      if (existsSync(schema)) {
        problems.push(...schemaDriftProblems(markdown, readFileSync(schema, 'utf8')).map((p) => `${file}: ${p}`));
      }
    }
  }
  if (!files.includes('docs/architecture.md')) problems.push('docs/architecture.md is missing');
  for (const problem of problems) console.error(`[docs] ${problem}`);
  if (problems.length > 0) return 1;
  console.log(`[docs] ok (${files.length} markdown files, links and anchors resolve)`);
  return 0;
}

if (isMain(import.meta.url)) process.exit(main());
