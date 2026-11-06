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

describe('monitoring files and documentation agree with the code', () => {
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
