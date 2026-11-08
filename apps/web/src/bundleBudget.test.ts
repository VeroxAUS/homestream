import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

interface Budget {
  name: string;
  limit: string;
}

const budgets = JSON.parse(readFileSync(resolve(process.cwd(), '.size-limit.json'), 'utf8')) as Budget[];

describe('bundle budget', () => {
  it('allows the player chunk with hls.js 200 kB gzip', () => {
    const player = budgets.find((entry) => entry.name === 'Player chunk with hls.js (gzip)');
    expect(player?.limit).toBe('200 kB');
  });

  it('documents the player budget in the web README', () => {
    const readme = readFileSync(resolve(process.cwd(), 'README.md'), 'utf8');
    const row = readme.split('\n').find((line) => line.includes('PlayerPage-*.js'));
    expect(row).toMatch(/\|\s*200 kB\s*\|/);
  });
});
