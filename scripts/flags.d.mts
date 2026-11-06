export interface FlagDefinitionLike {
  type: 'boolean' | 'multivariate';
  default: boolean | string;
  description: string;
  status: 'active' | 'planned';
  variants?: readonly string[];
}
export type FlagRegistryLike = Record<string, FlagDefinitionLike>;
export interface FlagUsage {
  referenced: Set<string>;
  evaluated: Map<string, string>;
}
export function loadRegistry(root: string): Promise<FlagRegistryLike>;
export function scanUsage(root: string, keys: string[]): FlagUsage;
export function checkFlags(
  registry: FlagRegistryLike,
  usage: FlagUsage,
): { dead: string[]; planned: string[]; unknown: Array<{ key: string; file: string }> };
export function flagBody(key: string, definition: FlagDefinitionLike): Record<string, unknown>;
export function syncFlags(
  registry: FlagRegistryLike,
  options: { personalKey: string; host?: string; fetchImpl?: typeof fetch; dryRun?: boolean },
): Promise<{ created: string[]; present: string[] }>;
export function main(argv: string[], root?: string, env?: NodeJS.ProcessEnv): Promise<number>;
