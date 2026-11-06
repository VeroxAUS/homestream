import { existsSync, readFileSync } from 'node:fs';
import {
  DATABASE_DOC,
  OPENAPI_FILE,
  SCHEMA_FILE,
  matchesCommitted,
  renderOpenApi,
  renderSchemaFromMigrations,
  undocumentedTables,
  writeGenerated,
} from './generated.js';

const USAGE = 'Usage: tsx src/docs/cli.ts <openapi|schema> [--check]';

async function openapi(check: boolean): Promise<boolean> {
  const content = await renderOpenApi();
  if (!check) {
    writeGenerated(OPENAPI_FILE, content);
    return true;
  }
  return matchesCommitted(OPENAPI_FILE, content, 'pnpm openapi:export');
}

function schema(check: boolean): boolean {
  const content = renderSchemaFromMigrations();
  if (!check) {
    writeGenerated(SCHEMA_FILE, content);
    return true;
  }
  const upToDate = matchesCommitted(SCHEMA_FILE, content, 'pnpm db:schema');
  const doc = existsSync(DATABASE_DOC) ? readFileSync(DATABASE_DOC, 'utf8') : '';
  const missing = undocumentedTables(content, doc);
  for (const table of missing) console.error(`[docs] docs/database.md has no "### \`${table}\`" section`);
  return upToDate && missing.length === 0;
}

async function main(argv: string[]): Promise<number> {
  const [command] = argv;
  const check = argv.includes('--check');
  if (command === 'openapi') return (await openapi(check)) ? 0 : 1;
  if (command === 'schema') return schema(check) ? 0 : 1;
  console.error(USAGE);
  return 2;
}

process.exit(await main(process.argv.slice(2)));
