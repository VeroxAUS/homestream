import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fenceProblems, scanFences } from './lib/markdown.mjs';
import { git, isMain, repoRoot, splitNul } from './lib/util.mjs';

/**
 * Checks that the commands and paths documented in AGENTS.md (and the repo-local skills and runbooks) are real:
 * every `pnpm ...` command resolves to a script or a built-in pnpm command, every repository path exists, every
 * `/api/...` endpoint is in docs/openapi.json, and AGENTS.md has the sections an agent needs. `pnpm agents:check`.
 */

export const REQUIRED_HEADINGS = [
  { label: 'project layout', pattern: /layout/i },
  { label: 'commands', pattern: /commands/i },
  { label: 'conventions', pattern: /conventions/i },
  { label: 'testing', pattern: /test/i },
  { label: 'telemetry rules', pattern: /telemetry/i },
  { label: 'PowerShell notes', pattern: /powershell/i },
  { label: 'skills and runbooks', pattern: /skills|runbooks/i },
  { label: 'new app readiness checklist', pattern: /readiness checklist/i },
  { label: 'CI checks', pattern: /\bCI\b|continuous integration/i },
];

/** pnpm commands that are not package scripts. */
const PNPM_BUILTINS = new Set([
  'add',
  'audit',
  'dlx',
  'exec',
  'i',
  'import',
  'install',
  'install-test',
  'link',
  'list',
  'ls',
  'outdated',
  'patch',
  'prune',
  'rebuild',
  'remove',
  'rm',
  'run',
  'run-script',
  'self-update',
  'store',
  'unlink',
  'up',
  'update',
  'why',
  '-v',
  '--version',
]);

/** Output and cache directories that exist after a build but not in a fresh clone. */
const GENERATED_SEGMENTS = new Set(['dist', 'coverage', 'reports', 'release', 'node_modules', '.turbo', 'build']);

export function loadWorkspace(root) {
  const read = (file) => JSON.parse(readFileSync(path.join(root, file), 'utf8'));
  const packages = [];
  for (const group of ['apps', 'packages']) {
    const dir = path.join(root, group);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      const manifest = path.join(group, name, 'package.json');
      if (existsSync(path.join(root, manifest))) packages.push(read(manifest));
    }
  }
  return { rootScripts: new Set(Object.keys(read('package.json').scripts ?? {})), packages };
}

function openApiMatchers(root) {
  const file = path.join(root, 'docs', 'openapi.json');
  if (!existsSync(file)) return null;
  const { paths = {} } = JSON.parse(readFileSync(file, 'utf8'));
  return Object.keys(paths).map((template) => new RegExp(`^${template.replace(/\{[^}]+\}/g, '[^/]+')}/?$`));
}

/** Fenced code lines as `{line, text}` and inline code spans as `{line, text}`. */
export function extractCode(markdown) {
  const blocks = [];
  const inline = [];
  for (const { line, text, kind, lang } of scanFences(markdown).lines) {
    if (kind === 'code') {
      if (lang !== 'mermaid') blocks.push({ line, text });
    } else if (kind === 'prose') {
      for (const match of text.matchAll(/`([^`\n]+)`/g)) inline.push({ line, text: match[1] });
    }
  }
  return { blocks, inline };
}

/** The `pnpm ...` commands on one line of a code block (split on `;`, `&&`, `||` and `|`). */
export function pnpmCommands(text) {
  const stripped = text
    .replace(/^\s*(?:PS[^>]*>|\$|>)\s+/, '')
    .replace(/\s+#.*$/, '')
    .trim();
  if (stripped.startsWith('#')) return [];
  return stripped
    .split(/;|&&|\|\||\|/)
    .map((part) => part.trim().replace(/^\{\s*|\s*\}$/g, ''))
    .filter((part) => /^pnpm(\s|$)/.test(part));
}

function tokens(command) {
  return [...command.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((match) => match[1] ?? match[2] ?? match[3]);
}

function filterMatches(filter, packages) {
  const name = filter.replace(/^\.\.\./, '').replace(/\.\.\.$/, '');
  if (name.startsWith('!')) return packages;
  const pattern = new RegExp(`^${name.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);
  return packages.filter((pkg) => pattern.test(pkg.name));
}

/** Leading pnpm options: the `--filter` selectors, whether the command is recursive, and where the command name starts. */
function parseGlobalOptions(parts) {
  const filters = [];
  let recursive = false;
  let index = 0;
  for (; index < parts.length; index += 1) {
    const part = parts[index];
    if (part === '--filter' || part === '-F') filters.push(parts[(index += 1)] ?? '');
    else if (part.startsWith('--filter=')) filters.push(part.slice('--filter='.length));
    else if (part === '-r' || part === '--recursive') recursive = true;
    else if (!part.startsWith('-')) break;
  }
  return { filters, recursive, index };
}

/** The script a pnpm command runs, or null when it is a built-in command or a placeholder. */
function scriptName(parts, index) {
  const name = parts[index];
  if (name === undefined || name.includes('<') || name.includes('$')) return null;
  if (name === 'run' || name === 'run-script') {
    const script = parts.slice(index + 1).find((part) => !part.startsWith('-'));
    return script === undefined || script.includes('<') ? null : script;
  }
  return PNPM_BUILTINS.has(name) ? null : name;
}

/** Problem text for one `pnpm ...` command, or null when it resolves. */
export function checkPnpmCommand(command, { rootScripts, packages }) {
  const parts = tokens(command).slice(1);
  const { filters, recursive, index } = parseGlobalOptions(parts);
  const name = scriptName(parts, index);
  if (name === null) return null;
  if (filters.length > 0) {
    const targets = filters.flatMap((filter) => filterMatches(filter, packages));
    if (targets.length === 0) return `no workspace package matches --filter ${filters.join(' ')}`;
    return targets.some((pkg) => pkg.scripts?.[name])
      ? null
      : `script "${name}" is not defined in ${filters.join(', ')}`;
  }
  if (recursive) {
    return packages.some((pkg) => pkg.scripts?.[name]) ? null : `no workspace package defines script "${name}"`;
  }
  return rootScripts.has(name) ? null : `root package.json has no script "${name}"`;
}
function isRepoPathCandidate(text, topLevel) {
  if (/[\s<>*{}$()|"'=]/.test(text) || text.includes('...')) return false;
  const normalized = text.replace(/\\/g, '/');
  if (normalized.startsWith('/') || normalized.startsWith('~') || /^[a-z]+:/i.test(normalized)) return false;
  const segments = normalized.split('/').filter(Boolean);
  if (segments.length < 2 && !normalized.endsWith('/')) return false;
  if (segments.some((segment) => GENERATED_SEGMENTS.has(segment))) return false;
  return topLevel.has(segments[0]);
}

/** Paths in `text` (a code span or command line) that look like repository files but do not exist. */
export function missingPaths(text, root, topLevel) {
  const missing = [];
  for (const token of text.split(/\s+/)) {
    const cleaned = token
      .replace(/^[("'`]+|[)"'`,;:.]+$/g, '')
      .replace(/:\d+(?:-\d+)?$/, '')
      .replace(/#.*$/, '');
    if (!isRepoPathCandidate(cleaned, topLevel)) continue;
    if (!existsSync(path.join(root, cleaned.replace(/\\/g, '/')))) missing.push(cleaned);
  }
  return missing;
}

function apiEndpoints(text) {
  return [...text.matchAll(/(?:^|[\s"'`(=]|:\d{2,5})(\/(?:api|hls)\/[A-Za-z0-9_\-/{}:.]*)/g)].map((match) => match[1]);
}

function checkEndpoint(endpoint, matchers) {
  const clean = endpoint.replace(/[.,;:]+$/, '').replace(/:\w+|\{[^}]*\}/g, '1');
  if (clean.includes('...') || clean.includes('*') || clean.endsWith('/')) return null;
  if (clean === '/api/docs' || clean.startsWith('/api/docs/')) return null;
  return matchers.some((matcher) => matcher.test(clean)) ? null : `${clean} is not an endpoint in docs/openapi.json`;
}

function commandProblems(text, context) {
  return pnpmCommands(text).flatMap((command) => {
    const problem = checkPnpmCommand(command, context);
    return problem ? [`\`${command}\`: ${problem}`] : [];
  });
}

function referenceProblems(text, context) {
  const problems = missingPaths(text, context.root, context.topLevel).map(
    (missing) => `path does not exist: ${missing}`,
  );
  if (context.endpoints) {
    for (const endpoint of apiEndpoints(text)) {
      const problem = checkEndpoint(endpoint, context.endpoints);
      if (problem) problems.push(problem);
    }
  }
  return problems;
}

/** All problems in one markdown file, as `file:line: message`. */
export function validateMarkdown(file, markdown, context) {
  const { blocks, inline } = extractCode(markdown);
  const found = [
    ...blocks.flatMap(({ line, text }) => commandProblems(text, context).map((message) => ({ line, message }))),
    ...[...blocks, ...inline].flatMap(({ line, text }) =>
      referenceProblems(text, context).map((message) => ({ line, message })),
    ),
    ...inline.flatMap(({ line, text }) => commandProblems(text, context).map((message) => ({ line, message }))),
  ];
  return [...fenceProblems(file, markdown), ...found.map(({ line, message }) => `${file}:${line}: ${message}`)];
}

export function missingHeadings(markdown) {
  const headings = markdown.split('\n').filter((line) => /^#{1,3}\s/.test(line));
  return REQUIRED_HEADINGS.filter(({ pattern }) => !headings.some((heading) => pattern.test(heading))).map(
    ({ label }) => label,
  );
}

function defaultFiles(root) {
  const files = ['AGENTS.md'];
  const skills = path.join(root, '.factory', 'skills');
  if (existsSync(skills)) {
    for (const name of readdirSync(skills)) files.push(path.join('.factory', 'skills', name, 'SKILL.md'));
  }
  const runbooks = path.join(root, 'docs', 'runbooks');
  if (existsSync(runbooks)) {
    for (const name of readdirSync(runbooks)) if (name.endsWith('.md')) files.push(path.join('docs', 'runbooks', name));
  }
  return files.filter((file) => existsSync(path.join(root, file)));
}

export function main(argv, root = repoRoot()) {
  const files = argv.length > 0 ? argv : defaultFiles(root);
  if (!files.includes('AGENTS.md') && argv.length === 0) {
    console.error('[agents-md] AGENTS.md is missing at the repository root');
    return 1;
  }
  const topLevel = new Set(
    splitNul(git(['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root })).map(
      (file) => file.split('/')[0],
    ),
  );
  const context = { ...loadWorkspace(root), root, topLevel, endpoints: openApiMatchers(root) };
  const problems = [];
  for (const file of files) {
    const markdown = readFileSync(path.join(root, file), 'utf8');
    problems.push(...validateMarkdown(file.replace(/\\/g, '/'), markdown, context));
    if (path.basename(file) === 'AGENTS.md') {
      for (const label of missingHeadings(markdown)) problems.push(`${file}: missing a section for ${label}`);
    }
  }
  for (const problem of problems) console.error(`[agents-md] ${problem}`);
  if (problems.length > 0) return 1;
  console.log(`[agents-md] ok (${files.length} file${files.length === 1 ? '' : 's'} checked)`);
  return 0;
}

if (isMain(import.meta.url)) process.exit(main(process.argv.slice(2)));
