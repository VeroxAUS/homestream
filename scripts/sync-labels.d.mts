export interface LabelSpec {
  name: string;
  color: string;
  description: string;
}
export function parseLabels(text: string): LabelSpec[];
export function planLabels(
  wanted: LabelSpec[],
  existing: Array<{ name: string; color: string; description?: string }>,
): Array<{ action: 'create' | 'update' | 'unchanged'; label: LabelSpec }>;
export function main(argv: string[], root?: string, gh?: (args: string[]) => string): number;
