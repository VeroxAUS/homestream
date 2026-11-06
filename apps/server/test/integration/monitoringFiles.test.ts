import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ANALYTICS_EVENTS, FLAG_KEYS } from '@homestream/shared';
import { clearSecrets } from '../../src/redact.js';
import { makeTempDir, removeDir, startTestApp } from '../helpers.js';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const read = (file: string): string => readFileSync(path.join(repoRoot, file), 'utf8');

let root: string;
let app: FastifyInstance;
let exposed: Set<string>;

beforeAll(async () => {
  root = makeTempDir('monitoring-files');
  app = await startTestApp(root);
  const text = (await app.inject('/metrics')).body;
  exposed = new Set([...text.matchAll(/^# TYPE (\S+) /gm)].map((match) => match[1] as string));
});

afterAll(async () => {
  await app.close();
  clearSecrets();
  removeDir(root);
});

function metricNames(text: string): string[] {
  const names = text.match(/\b(?:homestream|nodejs|process)_[a-z0-9_]+/g) ?? [];
  return [...new Set(names.map((name) => name.replace(/_(bucket|count|sum)$/, '')))];
}

const PROMQL_WORDS = new Set(['and', 'or', 'unless', 'by', 'without', 'on', 'ignoring', 'bool']);

/** The text of every `expr:` in a Prometheus rule file, single-line or block scalar. */
function expressions(yaml: string): string[] {
  const lines = yaml.split('\n');
  const found: string[] = [];
  lines.forEach((line, index) => {
    const match = /^(\s*)(?:-\s+)?expr:\s*(.*)$/.exec(line);
    if (!match) return;
    if (match[2] !== '|' && match[2] !== '>') {
      found.push(match[2] as string);
      return;
    }
    const body: string[] = [];
    for (const next of lines.slice(index + 1)) {
      if (next.trim() !== '' && next.length - next.trimStart().length <= (match[1] as string).length) break;
      body.push(next);
    }
    found.push(body.join('\n'));
  });
  return found;
}

/** Identifiers in a PromQL expression that are metric names: not functions, keywords, label names or numbers. */
function bareMetricNames(expression: string): string[] {
  const stripped = expression
    .replace(/"[^"]*"/g, '')
    .replace(/\{[^}]*\}/g, '')
    .replace(/\b(?:by|without)\s*\([^)]*\)/g, '')
    .replace(/\b\d[\w.]*/g, '');
  return [...stripped.matchAll(/\b([A-Za-z_:][A-Za-z0-9_:]*)\b(?!\s*\()/g)]
    .map((match) => match[1] as string)
    .filter((name) => !PROMQL_WORDS.has(name) && !/^(?:homestream|nodejs|process)_/.test(name));
}

describe('monitoring files and documentation agree with the code', () => {
  it('the only metric in the Prometheus alerts that /metrics does not expose is up, which Prometheus generates', () => {
    const rules = expressions(read('monitoring/prometheus/alerts.yml'));
    expect(rules.length).toBeGreaterThan(8);
    const bare = new Set(rules.flatMap(bareMetricNames));
    expect(bare).toEqual(new Set(['up']));
    expect(exposed.has('up')).toBe(false);
  });

  it('every metric used by a Prometheus alert is exposed by /metrics', () => {
    const names = metricNames(read('monitoring/prometheus/alerts.yml'));
    expect(names.length).toBeGreaterThan(8);
    for (const name of names) expect(exposed.has(name), name).toBe(true);
  });

  it('every HomeStream metric named in the docs is exposed by /metrics', () => {
    for (const file of ['docs/observability.md', 'docs/alerting.md']) {
      for (const name of metricNames(read(file)).filter((candidate) => candidate.startsWith('homestream_'))) {
        expect(exposed.has(name), `${file}: ${name}`).toBe(true);
      }
    }
  });

  it('docs/alerting.md describes every Prometheus alert and every Sentry workflow', () => {
    const doc = read('docs/alerting.md');
    const alerts = [...read('monitoring/prometheus/alerts.yml').matchAll(/- alert: (\w+)/g)].map((m) => m[1] as string);
    expect(alerts.length).toBeGreaterThan(8);
    for (const alert of alerts) expect(doc, alert).toContain(`\`${alert}\``);
    const rules = JSON.parse(read('monitoring/sentry/alert-rules.json')) as { workflows: Array<{ name: string }> };
    for (const workflow of rules.workflows) expect(doc, workflow.name).toContain(workflow.name);
  });

  it('docs/PRIVACY.md lists exactly the event catalog with its properties', () => {
    const doc = read('docs/PRIVACY.md');
    const section = doc.slice(doc.indexOf('### Event catalog'), doc.indexOf('### Install id'));
    const rows = [...section.matchAll(/^\| `(\w+)`\s*\|[^|]*\|([^\n]*)\|\s*$/gm)];
    expect(rows.map((row) => row[1])).toEqual(Object.keys(ANALYTICS_EVENTS));
    for (const row of rows) {
      const documented = [...(row[2] ?? '').matchAll(/`(\w+)`(\??)/g)].map((m) => `${m[1]}${m[2]}`);
      const event = ANALYTICS_EVENTS[row[1] as keyof typeof ANALYTICS_EVENTS];
      const declared = Object.entries(event.properties.shape).map(
        ([key, schema]) => `${key}${(schema as { isOptional(): boolean }).isOptional() ? '?' : ''}`,
      );
      expect(documented, String(row[1])).toEqual(declared);
    }
  });

  it('docs/experimentation.md lists every flag in the registry', () => {
    const doc = read('docs/experimentation.md');
    for (const key of FLAG_KEYS) expect(doc, key).toContain(`\`${key}\``);
  });
});
