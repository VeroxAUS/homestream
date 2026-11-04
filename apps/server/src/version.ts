import { readFileSync } from 'node:fs';
import path from 'node:path';

/** The server package.json sits one level above both src/ and dist/. */
export const serverRoot = path.resolve(import.meta.dirname, '..');

function readVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(path.join(serverRoot, 'package.json'), 'utf8')) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export const SERVER_VERSION = readVersion();
