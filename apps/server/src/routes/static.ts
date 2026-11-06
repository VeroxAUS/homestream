import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';

const API_PREFIXES = ['/api', '/hls'];

function pathnameOf(url: string): string {
  return url.split('?')[0] ?? '';
}

/** Client-side routes have no file extension; a missing asset such as /assets/x.js must still 404. */
export function shouldServeSpaFallback(url: string, method: string): boolean {
  if (method !== 'GET' && method !== 'HEAD') return false;
  const pathname = pathnameOf(url);
  if (API_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) return false;
  return !(pathname.split('/').pop() ?? '').includes('.');
}

const IMMUTABLE = 'public, max-age=31536000, immutable';

/** Files under `assets/` carry a content hash in their name, so they never change; everything else is revalidated. */
function cacheControlFor(webDir: string, filePath: string): string {
  const relative = path.relative(webDir, filePath).split(path.sep);
  return relative[0] === 'assets' ? IMMUTABLE : 'no-cache';
}

/** Returns true when a built web UI was found and is being served. */
export async function registerStatic(app: FastifyInstance, webDir: string | null): Promise<boolean> {
  if (!webDir || !existsSync(path.join(webDir, 'index.html'))) return false;
  const root = path.resolve(webDir);
  await app.register(fastifyStatic, {
    root,
    prefix: '/',
    wildcard: true,
    // The web build writes `.br` and `.gz` next to each text asset; browsers get the smaller file.
    preCompressed: true,
    setHeaders: (reply, filePath) => {
      void reply.header('Cache-Control', cacheControlFor(root, filePath));
    },
  });
  return true;
}
