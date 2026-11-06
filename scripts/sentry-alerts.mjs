import { readFileSync } from 'node:fs';
import path from 'node:path';
import { resolveEnv } from './lib/dotenv.mjs';
import { isMain, repoRoot } from './lib/util.mjs';

/**
 * Alerts as code for Sentry. This organisation uses Sentry's workflow-based alerting, so alerts are `workflows` and
 * monitors are `detectors`; the legacy alert-rule endpoints answer 404. Items are matched by name (and project), so
 * `--apply` can run any number of times: it creates what is missing, updates what drifted and leaves the rest alone.
 *   node scripts/sentry-alerts.mjs --dry-run   print the plan, change nothing
 *   node scripts/sentry-alerts.mjs --apply     make Sentry match monitoring/sentry/alert-rules.json
 * Uses SENTRY_API_TOKEN (the personal token; the organisation token cannot manage alerts) and SENTRY_ORG (the slug).
 */

const DEFAULT_RULES_FILE = path.join('monitoring', 'sentry', 'alert-rules.json');
const DEFAULT_API_BASE = 'https://sentry.io/api/0';
const REQUEST_TIMEOUT_MS = 20_000;
/** The rules file carries this placeholder; the real slug comes from SENTRY_ORG so it never lands in git. */
const ORG_PLACEHOLDER = '<your-sentry-org>';

export function parseArgs(argv) {
  const dryRun = argv.includes('--dry-run');
  const apply = argv.includes('--apply');
  const unknown = argv.filter((arg) => arg !== '--dry-run' && arg !== '--apply' && !arg.startsWith('--file='));
  if (dryRun === apply || unknown.length > 0) return null;
  const file = argv.find((arg) => arg.startsWith('--file='))?.slice('--file='.length);
  return { apply, file };
}

export function loadRules(file) {
  const rules = JSON.parse(readFileSync(file, 'utf8'));
  const problems = [];
  if (!rules.organization) problems.push('"organization" is missing');
  const names = new Set();
  for (const kind of ['detectors', 'workflows']) {
    for (const item of rules[kind] ?? []) {
      if (!item.name || !item.project) problems.push(`${kind} entry without a name or project`);
      const id = `${kind}:${item.project}:${item.name}`;
      if (names.has(id)) problems.push(`duplicate ${kind} entry "${item.name}"`);
      names.add(id);
    }
  }
  if (problems.length > 0) throw new Error(`${file}: ${problems.join('; ')}`);
  return { organization: rules.organization, detectors: rules.detectors ?? [], workflows: rules.workflows ?? [] };
}

/** True when every field of `wanted` is present with the same value in `actual` (extra fields and ids in `actual` are fine). */
export function covers(actual, wanted) {
  if (Array.isArray(wanted)) {
    return (
      Array.isArray(actual) && actual.length === wanted.length && wanted.every((item, i) => covers(actual[i], item))
    );
  }
  if (wanted !== null && typeof wanted === 'object') {
    return (
      actual !== null &&
      typeof actual === 'object' &&
      Object.entries(wanted).every(([key, value]) => covers(actual[key], value))
    );
  }
  return actual === wanted;
}

function detectorBody(rule, projectId) {
  const { project: _project, ...body } = rule;
  return { ...body, projectId };
}

function workflowBody(rule, detectorIds) {
  const { project: _project, detectors: _detectors, ...body } = rule;
  return { ...body, detectorIds };
}

export function createClient({ token, base = DEFAULT_API_BASE, organization, fetchImpl = fetch }) {
  const call = async (method, resource, body) => {
    const response = await fetchImpl(`${base}/organizations/${organization}/${resource}`, {
      method,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      const detail = (await response.text()).replace(/\s+/g, ' ').slice(0, 300);
      throw new Error(`${method} ${resource} answered ${response.status}: ${detail}`);
    }
    return response.status === 204 ? null : response.json();
  };
  return {
    get: (resource) => call('GET', resource),
    post: (resource, body) => call('POST', resource, body),
    put: (resource, body) => call('PUT', resource, body),
  };
}

async function projectIds(client, slugs) {
  const projects = await client.get('projects/');
  const ids = new Map();
  for (const slug of slugs) {
    const project = projects.find((candidate) => candidate.slug === slug);
    if (!project) throw new Error(`Sentry project "${slug}" was not found in this organisation.`);
    ids.set(slug, String(project.id));
  }
  return ids;
}

/**
 * Compares the rules with what Sentry has. Each step is {kind, name, action: create|update|unchanged, id?, body}.
 * Workflow bodies refer to detectors by name; those ids are filled in at apply time because a detector may not exist yet.
 */
export async function buildPlan(rules, client) {
  const slugs = [...new Set([...rules.detectors, ...rules.workflows].map((rule) => rule.project))];
  const ids = await projectIds(client, slugs);
  const [detectors, workflows] = await Promise.all([client.get('detectors/'), client.get('workflows/')]);
  const steps = [];
  for (const rule of rules.detectors) {
    const projectId = ids.get(rule.project);
    const body = detectorBody(rule, projectId);
    const existing = detectors.find((item) => item.name === rule.name && String(item.projectId) === projectId);
    steps.push(step('detector', rule.name, existing, body));
  }
  for (const rule of rules.workflows) {
    const projectId = ids.get(rule.project);
    const existing = workflows.find(
      (item) => item.name === rule.name && workflowProject(item, detectors) === projectId,
    );
    steps.push({ ...step('workflow', rule.name, existing, workflowBody(rule, [])), rule, projectId });
  }
  return { steps, detectors };
}

function workflowProject(workflow, detectors) {
  const first = detectors.find((detector) => (workflow.detectorIds ?? []).includes(String(detector.id)));
  return first?.projectId === null || first === undefined ? null : String(first.projectId);
}

function step(kind, name, existing, body) {
  if (!existing) return { kind, name, action: 'create', body };
  return { kind, name, action: 'update', id: String(existing.id), body, existing };
}

function resolveDetectorIds(rule, projectId, { detectors, created, declared }) {
  return rule.detectors.map((name) => {
    const known =
      created.get(`${projectId}:${name}`) ??
      detectors.find((item) => item.name === name && String(item.projectId) === projectId)?.id;
    if (known !== undefined) return String(known);
    // A detector this run is about to create has no id yet in a dry run.
    if (declared.has(`${rule.project}:${name}`)) return `pending:${name}`;
    throw new Error(`Workflow "${rule.name}" refers to a detector "${name}" that does not exist.`);
  });
}

/** Decides create, update or unchanged for each step once workflow detector ids are known. */
export function finalizeStep(planStep, known) {
  const body =
    planStep.kind === 'workflow'
      ? workflowBody(planStep.rule, resolveDetectorIds(planStep.rule, planStep.projectId, known))
      : planStep.body;
  if (planStep.action === 'create') return { ...planStep, body };
  return { ...planStep, body, action: covers(planStep.existing, body) ? 'unchanged' : 'update' };
}

export async function run(rules, client, { apply }, log = console.log) {
  const plan = await buildPlan(rules, client);
  const created = new Map();
  const declared = new Set(rules.detectors.map((rule) => `${rule.project}:${rule.name}`));
  const counts = { create: 0, update: 0, unchanged: 0, manual: 0 };
  for (const planned of plan.steps) {
    const resolved = finalizeStep(planned, { detectors: plan.detectors, created, declared });
    const prefix = apply || resolved.action === 'unchanged' ? '' : 'would ';
    log(`[sentry-alerts] ${resolved.kind} "${resolved.name}": ${prefix}${resolved.action}`);
    if (!apply || resolved.action === 'unchanged') {
      counts[resolved.action] += 1;
      continue;
    }
    const outcome = await applyStep(resolved, client, created);
    if (outcome === 'manual') log(`[sentry-alerts] ${resolved.kind} "${resolved.name}": ${MANUAL_HINT}`);
    counts[outcome === 'manual' ? 'manual' : resolved.action] += 1;
  }
  return counts;
}

const MANUAL_HINT =
  'the API token cannot create or change monitors in this organisation; do it in the Sentry UI (see docs/alerting.md).';

async function applyStep(step, client, created) {
  const resource = step.kind === 'detector' ? 'detectors/' : 'workflows/';
  try {
    const result =
      step.action === 'create'
        ? await client.post(resource, step.body)
        : await client.put(`${resource}${step.id}/`, step.body);
    if (step.kind === 'detector' && result?.id !== undefined)
      created.set(`${step.body.projectId}:${step.name}`, result.id);
    return 'done';
  } catch (error) {
    if (step.kind === 'detector' && /answered 40[35]/.test(error.message)) return 'manual';
    throw error;
  }
}

export async function main(argv, root = repoRoot(), env = process.env, fetchImpl = fetch) {
  const args = parseArgs(argv);
  if (!args) {
    console.error('Usage: node scripts/sentry-alerts.mjs <--dry-run|--apply> [--file=path]');
    return 2;
  }
  let rules;
  try {
    rules = loadRules(path.resolve(root, args.file ?? DEFAULT_RULES_FILE));
  } catch (error) {
    console.error(`[sentry-alerts] ${error instanceof Error ? error.message : 'cannot read the rules'}`);
    return 1;
  }
  const resolved = resolveEnv(root, env);
  const token = resolved.SENTRY_API_TOKEN;
  if (!token) {
    const total = rules.detectors.length + rules.workflows.length;
    console.log(
      `[sentry-alerts] ${total} item(s) in the rules file are valid. SENTRY_API_TOKEN is not set, so Sentry was not contacted.`,
    );
    return args.apply ? 1 : 0;
  }
  const organization = resolved.SENTRY_ORG || rules.organization;
  if (!organization || organization === ORG_PLACEHOLDER) {
    console.error('[sentry-alerts] SENTRY_ORG is not set. Put your Sentry organisation slug in .env.');
    return 1;
  }
  try {
    const client = createClient({
      token,
      organization,
      base: resolved.SENTRY_API_BASE ?? DEFAULT_API_BASE,
      fetchImpl,
    });
    const counts = await run(rules, client, args);
    const manual = counts.manual > 0 ? `, ${counts.manual} to create by hand` : '';
    console.log(
      `[sentry-alerts] ${counts.create} to create, ${counts.update} to update, ${counts.unchanged} unchanged${manual}${args.apply ? ' (applied)' : ' (dry run)'}`,
    );
    return 0;
  } catch (error) {
    console.error(`[sentry-alerts] ${error instanceof Error ? error.message : 'failed'}`);
    return 1;
  }
}

if (isMain(import.meta.url)) process.exit(await main(process.argv.slice(2)));
