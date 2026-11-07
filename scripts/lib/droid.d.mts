export interface ReviewFinding {
  path: string;
  line: number;
  severity: 'high' | 'medium' | 'low';
  category: string;
  title: string;
  body: string;
}
export interface Review {
  summary: string;
  findings: ReviewFinding[];
  structured: boolean;
}
export interface DroidRunOptions {
  promptFile: string;
  cwd: string;
  env?: NodeJS.ProcessEnv;
  spawnImpl?: unknown;
  timeoutMs?: number;
}
export function parseDroidOutput(stdout: string): string;
export function extractJsonObject(text: string): Record<string, unknown> | null;
export function normalizeReview(answer: string): Review;
export function runDroid(options: DroidRunOptions): Promise<string>;
