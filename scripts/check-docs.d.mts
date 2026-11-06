export const MIN_DIAGRAMS: number;
export const DIAGRAM_KEYWORDS: string[];
export function slugify(heading: string): string;
export function anchorsOf(markdown: string): Set<string>;
export function linksOf(markdown: string): Array<{ line: number; target: string }>;
export function mermaidBlocks(markdown: string): string[];
export function diagramProblems(markdown: string): string[];
export function checkFile(
  file: string,
  markdown: string,
  root: string,
  readTarget?: (target: string) => string,
): string[];
export function main(root?: string): number;
