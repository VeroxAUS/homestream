// Copies the files tsc does not emit (startup page, icons) next to the compiled code: assets/ -> dist/assets/.
import { cpSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
mkdirSync(path.join(root, 'dist'), { recursive: true });
cpSync(path.join(root, 'assets'), path.join(root, 'dist', 'assets'), { recursive: true });
