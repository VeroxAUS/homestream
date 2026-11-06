export interface PnpmContext {
  rootScripts: Set<string>;
  packages: Array<{ name: string; scripts?: Record<string, string> }>;
}
export const REQUIRED_HEADINGS: Array<{ label: string; pattern: RegExp }>;
export function pnpmCommands(text: string): string[];
export function checkPnpmCommand(command: string, context: PnpmContext): string | null;
export function missingHeadings(markdown: string): string[];
export function main(argv: string[], root?: string): number;
