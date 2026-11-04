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

/** Returns true when a built web UI was found and is being served. */
export async function registerStatic(app: FastifyInstance, webDir: string | null): Promise<boolean> {
  if (!webDir || !existsSync(path.join(webDir, 'index.html'))) return false;
  await app.register(fastifyStatic, { root: path.resolve(webDir), prefix: '/', wildcard: true });
  return true;
}
