import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { git, isMain, repoRoot, splitNul } from './lib/util.mjs';

/**
 * Checks the markdown documentation: every relative link points at an existing file, every `#anchor` matches a heading
 * in the target file, and docs/architecture.md has its mermaid diagrams. `pnpm docs:check`.
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
  return heading
    .trim()
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');
}

/** Lines outside fenced code blocks, with their 1-based numbers. */
function proseLines(markdown) {
  const lines = [];
  let fenced = false;
  markdown.split('\n').forEach((text, index) => {
    if (/^\s*```/.test(text)) fenced = !fenced;
    else if (!fenced) lines.push({ line: index + 1, text });
  });
  return lines;
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
  return [...markdown.matchAll(/^```mermaid[^\n]*\n([\s\S]*?)^```/gm)].map((match) => match[1]);
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
  const problems = [];
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
    if (file === 'docs/architecture.md') problems.push(...diagramProblems(markdown).map((p) => `${file}: ${p}`));
  }
  if (!files.includes('docs/architecture.md')) problems.push('docs/architecture.md is missing');
  for (const problem of problems) console.error(`[docs] ${problem}`);
  if (problems.length > 0) return 1;
  console.log(`[docs] ok (${files.length} markdown files, links and anchors resolve)`);
  return 0;
}

if (isMain(import.meta.url)) process.exit(main());
