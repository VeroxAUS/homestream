import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { isMain } from './lib/util.mjs';

/**
 * Makes a wiki folder an exact copy of the generated wiki artifact. The publish job calls it before the pull request
 * is opened, so a page the generator dropped (see page-plan.json) is removed from git instead of surviving an overlay.
 * The video overview and the screenshots never travel in the artifact and stay out of git, so they are left alone.
 *   node scripts/wiki-mirror.mjs <artifact-dir> <wiki-dir>
 */

const KEPT_FOLDERS = new Set(['video', 'images']);
/** Written by every generator run; an artifact without it is not a wiki, and mirroring it would delete the real one. */
const META_FILE = '.wiki-meta.json';

export function mirrorWiki(artifactDir, wikiDir) {
  if (!existsSync(path.join(artifactDir, META_FILE))) {
    throw new Error(`${artifactDir} has no ${META_FILE}; refusing to replace ${wikiDir}.`);
  }
  mkdirSync(wikiDir, { recursive: true });
  for (const name of readdirSync(wikiDir)) {
    if (!KEPT_FOLDERS.has(name)) rmSync(path.join(wikiDir, name), { recursive: true, force: true });
  }
  for (const name of readdirSync(artifactDir)) {
    if (!KEPT_FOLDERS.has(name)) cpSync(path.join(artifactDir, name), path.join(wikiDir, name), { recursive: true });
  }
}

if (isMain(import.meta.url)) {
  const [artifactDir, wikiDir] = process.argv.slice(2);
  if (!artifactDir || !wikiDir) {
    console.error('Usage: node scripts/wiki-mirror.mjs <artifact-dir> <wiki-dir>');
    process.exit(2);
  }
  try {
    mirrorWiki(artifactDir, wikiDir);
    console.log(`[wiki-mirror] ${wikiDir} now mirrors ${artifactDir}`);
  } catch (error) {
    console.error(`[wiki-mirror] ${error instanceof Error ? error.message : 'failed'}`);
    process.exit(1);
  }
}
