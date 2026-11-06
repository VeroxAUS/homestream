import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { isMain, repoRoot } from './lib/util.mjs';

/**
 * Makes the repository labels match .github/labels.yml: creates missing labels and updates colour and description of
 * existing ones. Never deletes a label. Uses the gh CLI (authenticated, with `repo` scope).
 *   node scripts/sync-labels.mjs [--dry-run] [--repo owner/name]
 */

const LABELS_FILE = path.join('.github', 'labels.yml');

const unquote = (value) => value.trim().replace(/^(['"])(.*)\1$/, '$2');

/** Parses the flat `- name:` / `color:` / `description:` list used by labels.yml. */
export function parseLabels(text) {
  const labels = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const match = /^(- |\s+)(name|color|description):\s*(.*)$/.exec(line);
    if (!match) throw new Error(`Unrecognised line in ${LABELS_FILE}: ${line}`);
    const [, lead, key, value] = match;
    if (lead === '- ') {
      if (key !== 'name') throw new Error(`A label entry must start with "name": ${line}`);
      labels.push({ name: unquote(value), color: '', description: '' });
    } else if (labels.length === 0 || key === 'name') {
      throw new Error(`Unexpected line in ${LABELS_FILE}: ${line}`);
    } else {
      labels[labels.length - 1][key] = unquote(value);
    }
  }
  for (const label of labels) {
    if (!/^[0-9a-f]{6}$/i.test(label.color)) throw new Error(`Label "${label.name}" needs a 6-digit hex colour.`);
  }
  return labels;
}

/** Steps `{action: create|update|unchanged, label}` for the wanted labels given the existing ones. */
export function planLabels(wanted, existing) {
  const byName = new Map(existing.map((label) => [label.name.toLowerCase(), label]));
  return wanted.map((label) => {
    const current = byName.get(label.name.toLowerCase());
    if (!current) return { action: 'create', label };
    const same =
      current.color.toLowerCase() === label.color.toLowerCase() && (current.description ?? '') === label.description;
    return { action: same ? 'unchanged' : 'update', label };
  });
}

function ghRunner(args) {
  return execFileSync('gh', args, { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
}

export function main(argv, root = repoRoot(), gh = ghRunner) {
  const dryRun = argv.includes('--dry-run');
  const repoIndex = argv.indexOf('--repo');
  const repoArgs = repoIndex >= 0 && argv[repoIndex + 1] ? ['--repo', argv[repoIndex + 1]] : [];
  const wanted = parseLabels(readFileSync(path.join(root, LABELS_FILE), 'utf8'));
  const existing = JSON.parse(gh(['label', 'list', '--limit', '200', '--json', 'name,color,description', ...repoArgs]));
  const steps = planLabels(wanted, existing);
  for (const { action, label } of steps) {
    if (action !== 'unchanged' && !dryRun) {
      const verb = action === 'create' ? 'create' : 'edit';
      gh(['label', verb, label.name, '--color', label.color, '--description', label.description, ...repoArgs]);
    }
    console.log(`${action.padEnd(9)} ${label.name}`);
  }
  const counts = (action) => steps.filter((step) => step.action === action).length;
  console.log(
    `${counts('create')} created, ${counts('update')} updated, ${counts('unchanged')} unchanged${dryRun ? ' (dry run)' : ''}`,
  );
  return 0;
}

if (isMain(import.meta.url)) process.exit(main(process.argv.slice(2)));
