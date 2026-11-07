import path from 'node:path';
import { fileURLToPath } from 'node:url';
import js from '@eslint/js';
import globals from 'globals';
import sonarjs from 'eslint-plugin-sonarjs';
import tseslint from 'typescript-eslint';
import { limitConfigBlocks, readBaseline } from './scripts/lib/code-limits.mjs';

const COMPLEXITY_CEILING = 20;
const COGNITIVE_COMPLEXITY_CEILING = 20;

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/release/**', '**/node_modules/**', 'apps/tv/**', '**/coverage/**', '**/reports/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: { sonarjs },
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
      complexity: ['error', COMPLEXITY_CEILING],
      'max-depth': ['error', 4],
      'sonarjs/cognitive-complexity': ['error', COGNITIVE_COMPLEXITY_CEILING],
      'no-warning-comments': ['warn', { terms: ['todo', 'fixme', 'hack', 'xxx'], location: 'start' }],
      '@typescript-eslint/naming-convention': [
        'error',
        { selector: 'default', format: ['camelCase'], leadingUnderscore: 'allow', trailingUnderscore: 'forbid' },
        {
          selector: 'variable',
          format: ['camelCase', 'UPPER_CASE', 'PascalCase'],
          leadingUnderscore: 'allow',
        },
        { selector: 'function', format: ['camelCase', 'PascalCase'], leadingUnderscore: 'allow' },
        { selector: 'parameter', format: ['camelCase', 'PascalCase'], leadingUnderscore: 'allow' },
        { selector: 'typeLike', format: ['PascalCase'] },
        { selector: 'enumMember', format: ['PascalCase', 'UPPER_CASE'] },
        // Object and class members mirror wire formats, HTTP headers, env keys and DB columns.
        { selector: ['property', 'method', 'accessor'], format: null },
        { selector: 'import', format: null },
      ],
    },
  },
  // Measured ceilings of functions that predate the complexity rules. A file may not get worse than its entry, and an
  // entry is removed when the file is refactored below COMPLEXITY_CEILING. Do not add entries for new code.
  ...[
    { file: 'apps/server/src/config.ts', cyclomatic: 29 },
    { file: 'apps/server/src/health/checks/torbox.ts', cyclomatic: 27, cognitive: 22 },
    { file: 'apps/server/src/playback/diskCap.ts', cyclomatic: 24, cognitive: 43 },
    { file: 'apps/server/src/playback/probe.ts', cyclomatic: 31, cognitive: 22 },
    // Hot path of the source proxy: streaming loop with explicit back-pressure and retry handling.
    { file: 'apps/server/src/sourceproxy/serve.ts', cyclomatic: 34, cognitive: 61, depth: 5 },
    { file: 'apps/server/src/sourceproxy/sourceEntry.ts', cognitive: 22 },
    { file: 'apps/server/test/playback/subtitleSources.ts', cognitive: 36 },
  ].map(({ file, cyclomatic, cognitive, depth }) => ({
    files: [file],
    rules: {
      ...(cyclomatic && { complexity: ['error', cyclomatic] }),
      ...(cognitive && { 'sonarjs/cognitive-complexity': ['error', cognitive] }),
      ...(depth && { 'max-depth': ['error', depth] }),
    },
  })),
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser },
    },
  },
  // Line limits for apps/* and packages/*; code-limits.baseline.json holds the ceilings of files that predate them.
  ...limitConfigBlocks(readBaseline(path.dirname(fileURLToPath(import.meta.url)))),
);
