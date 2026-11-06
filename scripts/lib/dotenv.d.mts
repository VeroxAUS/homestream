export function readDotEnv(root: string): Record<string, string>;
export function resolveEnv(root: string, env?: NodeJS.ProcessEnv): Record<string, string>;
