import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { readDotEnv, resolveEnv } from '../../../../scripts/lib/dotenv.mjs';
import { makeTempDir, removeDir } from '../helpers.js';

const root = makeTempDir('dotenv');
afterAll(() => removeDir(root));

describe('dotenv helper', () => {
  it('returns nothing when there is no .env', () => {
    expect(readDotEnv(root)).toEqual({});
  });

  it('reads KEY=value lines, strips quotes and skips comments', () => {
    writeFileSync(path.join(root, '.env'), '# comment\nA=1\r\nB = "two words"\nC=\'x\'\nnot a line\n');
    expect(readDotEnv(root)).toEqual({ A: '1', B: 'two words', C: 'x' });
  });

  it('lets the process environment win and ignores empty values', () => {
    expect(resolveEnv(root, { A: '9', B: '', D: 'new' })).toEqual({ A: '9', B: 'two words', C: 'x', D: 'new' });
  });
});
