import { describe, expect, it } from 'vitest';
import { fencedBlocks, fenceProblems, scanFences } from '../../../../scripts/lib/markdown.mjs';

describe('scanFences', () => {
  it('keeps a four-backtick block that contains a three-backtick line as one block', () => {
    const markdown = ['````powershell', 'pnpm lint', '```', 'pnpm test', '````', 'prose'].join('\n');
    const { lines, unclosed } = scanFences(markdown);
    expect(lines.map((entry) => entry.kind)).toEqual(['open', 'code', 'code', 'code', 'close', 'prose']);
    expect(unclosed).toBeNull();
  });

  it('does not let "```n" close a three-backtick fence', () => {
    const markdown = ['```powershell', 'pnpm lint', '```n', 'Telemetry paragraph'].join('\n');
    const { lines, unclosed } = scanFences(markdown);
    expect(lines.map((entry) => entry.kind)).toEqual(['open', 'code', 'code', 'code']);
    expect(unclosed).toBe(1);
  });

  it('closes only with the same character and at least the same length', () => {
    const markdown = ['~~~~', '~~~', '```', '~~~~~', 'after'].join('\n');
    expect(scanFences(markdown).lines.map((entry) => entry.kind)).toEqual(['open', 'code', 'code', 'close', 'prose']);
  });

  it('treats a closer line with trailing whitespace as a closer and one with text as content', () => {
    const markdown = ['```', 'a', '``` trailing', '```  ', 'prose'].join('\n');
    expect(scanFences(markdown).lines.map((entry) => entry.kind)).toEqual(['open', 'code', 'code', 'close', 'prose']);
  });

  it('does not open a fence on an inline code span at the start of a line', () => {
    expect(scanFences('```code``` and more').lines[0]?.kind).toBe('prose');
  });
});

describe('fenceProblems', () => {
  it('reports an unclosed fence as file:<line>: unclosed code fence', () => {
    expect(fenceProblems('AGENTS.md', 'text\n\n```powershell\npnpm lint\n')).toEqual([
      'AGENTS.md:3: unclosed code fence',
    ]);
  });

  it('reports nothing for balanced fences', () => {
    expect(fenceProblems('a.md', '```\nx\n```\n')).toEqual([]);
  });
});

describe('fencedBlocks', () => {
  it('returns the body and info string of each closed block', () => {
    const blocks = fencedBlocks('```mermaid\nflowchart LR\n```\n\n````md\n```\n````\n');
    expect(blocks).toEqual([
      { lang: 'mermaid', line: 2, lines: ['flowchart LR'] },
      { lang: 'md', line: 6, lines: ['```'] },
    ]);
  });
});
