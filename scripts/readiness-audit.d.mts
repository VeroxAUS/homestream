export interface CheckResult {
  status: 'PASS' | 'FAIL' | 'SKIP';
  evidence: string;
}
export interface Criterion {
  id: string;
  pillar: string;
  level: 1 | 2 | 3 | 4;
  scope: 'repo' | 'app';
  library?: boolean;
  appliesTo?: string[];
  checker: { type: string; [key: string]: unknown };
  tv?: { type: string; [key: string]: unknown };
}
export interface CriteriaFile {
  defaultApps: string[];
  libraries: string[];
  criteria: Criterion[];
}
export interface CriterionResult extends CheckResult {
  id: string;
  level: number;
  scope: 'repo' | 'app';
  skippedBy?: 'gh';
  apps: Array<CheckResult & { app: string }>;
}
export interface LevelRate {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  conservative: number;
  evaluated: number;
}
export interface Context {
  root: string;
  run: (command: string, args: string[]) => { status: number; stdout: string };
  repo: string | null;
}
export const LEVEL_MINIMUMS: Record<number, number>;
export const STRICT_MINIMUMS: Record<number, number>;
export function loadCriteria(root: string): CriteriaFile;
export function discoverProjects(root: string): { apps: string[]; libraries: string[] };
export function createContext(root: string, overrides?: Partial<Pick<Context, 'run' | 'repo'>>): Context;
export function runChecker(
  checker: Criterion['checker'],
  context: Context,
  scope?: { dir?: string; name?: string },
): CheckResult;
export function evaluateCriterion(
  criterion: Criterion,
  context: Context,
  projects: { apps: string[]; libraries: string[] },
): CheckResult & { apps: Array<CheckResult & { app: string }> };
export function levelRates(results: Array<{ level: number; status: string }>): Record<number, LevelRate>;
export function decide(
  results: CriterionResult[],
  levels: Record<number, LevelRate>,
  options?: { strict?: boolean },
): { ok: boolean; reasons: string[] };
export function selectApps(
  projects: { apps: string[]; libraries: string[] },
  argv: string[],
  config: Pick<CriteriaFile, 'defaultApps'>,
): { apps: string[]; libraries: string[] };
export function audit(
  root: string,
  argv: string[],
  overrides?: Partial<Pick<Context, 'run' | 'repo'>>,
): {
  projects: { apps: string[]; libraries: string[] };
  results: CriterionResult[];
  levels: Record<number, LevelRate>;
  decision: { ok: boolean; reasons: string[] };
};
export function main(argv: string[], root?: string, overrides?: Partial<Pick<Context, 'run' | 'repo'>>): number;
