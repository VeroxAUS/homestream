export interface FenceLine {
  line: number;
  text: string;
  kind: 'prose' | 'open' | 'code' | 'close';
  lang?: string;
}
export function scanFences(markdown: string): { lines: FenceLine[]; unclosed: number | null };
export function fenceProblems(file: string, markdown: string): string[];
export function fencedBlocks(markdown: string): Array<{ lang: string; line: number; lines: string[] }>;
