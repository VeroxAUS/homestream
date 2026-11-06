export const REQUIRED_NODE_MAJOR: number;
export function runCommand(command: string, cwd?: string): boolean;
export function readCommand(command: string, cwd?: string): string | null;
export function nodeMajor(version?: string): number;
export function ensureEnvFile(root: string): 'created' | 'kept' | 'missing-template';
export function describeFfmpeg(encodersOutput: string | null): { level: 'ok' | 'warn'; text: string };
export function bootstrap(deps?: {
  root?: string;
  run?: (command: string, cwd?: string) => boolean;
  read?: (command: string, cwd?: string) => string | null;
  version?: string;
  isCi?: boolean;
}): number;
