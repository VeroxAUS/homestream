import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { main, parseLabels, planLabels } from '../../../../scripts/sync-labels.mjs';
import { makeTempDir, removeDir } from '../helpers.js';

const roots: string[] = [];
afterAll(() => {
  for (const dir of roots) removeDir(dir);
});
afterEach(() => vi.restoreAllMocks());

const root = path.resolve(import.meta.dirname, '..', '..', '..', '..');
const REQUIRED = [
  'type:bug',
  'type:feature',
  'type:chore',
  'type:docs',
  'area:server',
  'area:web',
  'area:desktop',
  'area:tv',
  'area:ci',
  'area:docs',
  'priority:p0',
  'priority:p1',
  'priority:p2',
  'flaky-test',
  'sentry',
  'dependencies',
  'telemetry',
  'good first issue',
  'droid-wiki',
];

describe('.github/labels.yml', () => {
  const labels = parseLabels(readFileSync(path.join(root, '.github', 'labels.yml'), 'utf8'));

  it('defines every label the workflows, templates and readiness audit use', () => {
    const names = labels.map((label) => label.name);
    for (const name of REQUIRED) expect(names).toContain(name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('gives every label a colour and a description', () => {
    for (const label of labels) {
      expect(label.color).toMatch(/^[0-9a-f]{6}$/);
      expect(label.description.length).toBeGreaterThan(5);
    }
  });
});

describe('parseLabels', () => {
  it('reads quoted and unquoted values and ignores comments', () => {
    const parsed = parseLabels("# c\n- name: 'a b'\n  color: 'ABCDEF'\n  description: Hello: world\n");
    expect(parsed).toEqual([{ name: 'a b', color: 'ABCDEF', description: 'Hello: world' }]);
  });

  it('rejects a label without a valid colour', () => {
    expect(() => parseLabels('- name: x\n  color: red\n')).toThrow(/hex colour/);
  });
});

describe('planLabels and main', () => {
  const wanted = [
    { name: 'a', color: '111111', description: 'one' },
    { name: 'b', color: '222222', description: 'two' },
    { name: 'c', color: '333333', description: 'three' },
  ];
  const existing = [
    { name: 'a', color: '111111', description: 'one' },
    { name: 'B', color: '999999', description: 'two' },
  ];

  it('creates, updates and leaves unchanged (case-insensitive names)', () => {
    expect(planLabels(wanted, existing).map((step) => step.action)).toEqual(['unchanged', 'update', 'create']);
  });

  it('calls gh create and edit only for the differences, and nothing on a dry run', () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const dir = makeTempDir('sync-labels');
    roots.push(dir);
    mkdirSync(path.join(dir, '.github'));
    const yaml = wanted
      .map((l) => `- name: ${l.name}\n  color: ${l.color}\n  description: ${l.description}\n`)
      .join('');
    writeFileSync(path.join(dir, '.github', 'labels.yml'), yaml);
    const calls: string[][] = [];
    const gh = (args: string[]) => {
      calls.push(args);
      return args[1] === 'list' ? JSON.stringify(existing) : '';
    };
    expect(main(['--dry-run'], dir, gh)).toBe(0);
    expect(calls.filter((args) => args[1] !== 'list')).toHaveLength(0);
    expect(main(['--repo', 'o/r'], dir, gh)).toBe(0);
    const writes = calls.filter((args) => args[1] !== 'list').map((args) => `${args[1]} ${args[2]}`);
    expect(writes).toEqual(['edit b', 'create c']);
    expect(calls.at(-1)).toContain('o/r');
  });
});
