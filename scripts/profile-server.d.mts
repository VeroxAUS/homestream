export function parseArgs(argv: string[]): { port: number; seconds: number } | null;
export function serverEnv(port: number, dataDir: string, base?: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
export function main(argv: string[], root?: string): Promise<number>;
