import { existsSync } from 'node:fs';
import path from 'node:path';
import { SERVER_VERSION, serverRoot } from '../version.js';
import { smokeMain } from './smoke.js';

const workspaceRoot = path.resolve(serverRoot, '..', '..');
const repoRoot = existsSync(path.join(workspaceRoot, 'pnpm-workspace.yaml')) ? workspaceRoot : null;
process.exit(
  await smokeMain(process.argv.slice(2), { repoRoot, version: SERVER_VERSION }, (line) => console.log(line)),
);
