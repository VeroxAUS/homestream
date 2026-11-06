// Stub upstreams for the end-to-end tests: TMDB, the AIOStreams gateway and the Sentry and PostHog receivers.
// Everything listens on loopback only and nothing here needs a key. Run it with `node e2e/support/hub.mjs`.
import { createServer } from 'node:http';
import { gunzipSync } from 'node:zlib';
import ports from '../ports.json' with { type: 'json' };

const HOST = '127.0.0.1';
const IMAGE_BASE = `http://${HOST}:${ports.tmdb}/img/`;
// 1x1 transparent PNG
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

const MOVIES = [
  { id: 603, title: 'The Stub Matrix', release_date: '1999-03-30', vote_average: 8.2, overview: 'A stub film.' },
  { id: 604, title: 'Stub Reloaded', release_date: '2003-05-15', vote_average: 7.1, overview: 'Another stub film.' },
];
const SHOWS = [
  { id: 1399, name: 'Stub Thrones', first_air_date: '2011-04-17', vote_average: 8.4, overview: 'A stub show.' },
];

const captured = { sentry: [], posthog: [] };

function send(response, status, body, headers = {}) {
  const isBuffer = Buffer.isBuffer(body);
  response.writeHead(status, {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': '*',
    'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS',
    'content-type': isBuffer ? 'image/png' : 'application/json',
    ...headers,
  });
  response.end(isBuffer ? body : JSON.stringify(body));
}

function readBody(request) {
  return new Promise((resolve) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', () => resolve(Buffer.alloc(0)));
  });
}

function withArt(item) {
  return { ...item, poster_path: '/poster.png', backdrop_path: '/backdrop.png' };
}

function tmdb(url) {
  const { pathname, searchParams } = url;
  if (pathname === '/configuration') return [200, { images: { secure_base_url: IMAGE_BASE } }];
  if (pathname.startsWith('/trending/movie') || pathname === '/movie/popular')
    return [200, { results: MOVIES.map(withArt) }];
  if (pathname.startsWith('/trending/tv') || pathname === '/tv/popular') return [200, { results: SHOWS.map(withArt) }];
  if (pathname === '/search/multi') {
    const query = (searchParams.get('query') ?? '').toLowerCase();
    const results = [
      ...MOVIES.map((m) => ({ ...withArt(m), media_type: 'movie' })),
      ...SHOWS.map((s) => ({ ...withArt(s), media_type: 'tv' })),
    ].filter((item) => (item.title ?? item.name).toLowerCase().includes(query));
    return [200, { results }];
  }
  const movie = /^\/movie\/(\d+)$/.exec(pathname);
  const found = movie && MOVIES.find((m) => m.id === Number(movie[1]));
  if (found) return [200, { ...withArt(found), runtime: 136, genres: [{ id: 1, name: 'Stub' }], imdb_id: 'tt0000603' }];
  return [404, { status_message: 'The resource you requested could not be found.' }];
}

function listen(port, handler) {
  return new Promise((resolve, reject) => {
    const server = createServer((request, response) => {
      if (request.method === 'OPTIONS') return send(response, 204, '');
      Promise.resolve(handler(request, response)).catch(() => send(response, 500, { error: 'stub failure' }));
    });
    server.once('error', reject);
    server.listen(port, HOST, () => resolve(server));
  });
}

async function tmdbHandler(request, response) {
  const url = new URL(request.url ?? '/', `http://${HOST}`);
  if (url.pathname.startsWith('/img/')) return send(response, 200, PNG);
  const [status, body] = tmdb(url);
  return send(response, status, body);
}

function gatewayHandler(request, response) {
  if ((request.url ?? '').includes('manifest.json')) {
    return send(response, 200, {
      id: 'e2e.stub',
      version: '1.0.0',
      name: 'Stub gateway',
      resources: ['stream'],
      types: ['movie', 'series'],
      catalogs: [],
    });
  }
  return send(response, 200, { streams: [] });
}

/** Sentry envelope: header line, then item header and payload lines. Keeps the events and their raw size. */
function parseEnvelope(text) {
  const lines = text.split('\n').filter(Boolean);
  const items = [];
  for (let i = 1; i + 1 < lines.length; i += 2) {
    try {
      const header = JSON.parse(lines[i]);
      if (header.type === 'event') items.push(JSON.parse(lines[i + 1]));
    } catch {
      // not an event item
    }
  }
  return items;
}

function decodePostHog(buffer) {
  let raw = buffer.length > 1 && buffer[0] === 0x1f && buffer[1] === 0x8b ? gunzipSync(buffer) : buffer;
  let text = raw.toString('utf8');
  if (text.startsWith('data=')) text = Buffer.from(decodeURIComponent(text.slice(5)), 'base64').toString('utf8');
  const parsed = JSON.parse(text);
  const batch = Array.isArray(parsed) ? parsed : (parsed.batch ?? [parsed]);
  return batch.filter((item) => typeof item.event === 'string');
}

async function sentryHandler(request, response) {
  const url = new URL(request.url ?? '/', `http://${HOST}`);
  if (url.pathname === '/__health') return send(response, 200, { ok: true });
  if (url.pathname === '/__captured') {
    if (request.method === 'DELETE') {
      captured.sentry.length = 0;
      captured.posthog.length = 0;
      return send(response, 200, { ok: true });
    }
    return send(response, 200, captured);
  }
  const body = await readBody(request);
  if (/\/envelope\/?$/.test(url.pathname)) {
    let text = body.toString('utf8');
    if (body.length > 1 && body[0] === 0x1f && body[1] === 0x8b) text = gunzipSync(body).toString('utf8');
    captured.sentry.push(...parseEnvelope(text));
  }
  return send(response, 200, { id: 'stub' });
}

async function posthogHandler(request, response) {
  const url = new URL(request.url ?? '/', `http://${HOST}`);
  const body = await readBody(request);
  if (request.method === 'POST' && body.length > 0) {
    try {
      captured.posthog.push(...decodePostHog(body));
    } catch {
      // not an event batch
    }
  }
  if (url.pathname.startsWith('/flags') || url.pathname.startsWith('/decide'))
    return send(response, 200, { featureFlags: {} });
  return send(response, 200, { status: 1 });
}

await Promise.all([
  listen(ports.tmdb, tmdbHandler),
  listen(ports.gateway, gatewayHandler),
  listen(ports.sentry, sentryHandler),
  listen(ports.posthog, posthogHandler),
]);
console.log(
  `e2e stubs ready: tmdb ${ports.tmdb}, gateway ${ports.gateway}, sentry ${ports.sentry}, posthog ${ports.posthog}`,
);
