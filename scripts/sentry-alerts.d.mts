export interface AlertRule {
  name: string;
  project: string;
  [key: string]: unknown;
}
export interface AlertRules {
  organization: string;
  detectors: AlertRule[];
  workflows: Array<AlertRule & { detectors: string[] }>;
}
export interface SentryClient {
  get(resource: string): Promise<unknown>;
  post(resource: string, body: unknown): Promise<unknown>;
  put(resource: string, body: unknown): Promise<unknown>;
}
export function parseArgs(argv: string[]): { apply: boolean; file: string | undefined } | null;
export function loadRules(file: string): AlertRules;
export function covers(actual: unknown, wanted: unknown): boolean;
export function createClient(options: {
  token: string;
  base?: string;
  organization: string;
  fetchImpl?: typeof fetch;
}): SentryClient;
export function buildPlan(rules: AlertRules, client: SentryClient): Promise<{ steps: unknown[]; detectors: unknown[] }>;
export function finalizeStep(planStep: unknown, known: unknown): { action: string; body: unknown };
export function run(
  rules: AlertRules,
  client: SentryClient,
  options: { apply: boolean },
  log?: (line: string) => void,
): Promise<{ create: number; update: number; unchanged: number; manual: number }>;
export function main(argv: string[], root?: string, env?: NodeJS.ProcessEnv, fetchImpl?: typeof fetch): Promise<number>;
