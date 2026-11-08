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

// Titles that only appear in details responses (recommendations and similar), never on Home or in search.
const RELATED_MOVIES = [
  { id: 604, title: 'Stub Reloaded', release_date: '2003-05-15', vote_average: 7.1, overview: 'Another stub film.' },
  { id: 700, title: 'Stub Revolutions', release_date: '2003-11-05', vote_average: 6.7, overview: 'A third stub film.' },
  {
    id: 701,
    title: 'Stub Resurrections',
    release_date: '2021-12-22',
    vote_average: 5.7,
    overview: 'A fourth stub film.',
  },
  { id: 702, title: 'Stub Origins', release_date: '1998-01-01', vote_average: 6.1, overview: 'A similar stub film.' },
];
const RELATED_SHOWS = [
  {
    id: 1400,
    name: 'Stub Kingdoms',
    first_air_date: '2013-06-02',
    vote_average: 8.0,
    overview: 'A related stub show.',
  },
  { id: 1401, name: 'Stub Dragons', first_air_date: '2015-04-12', vote_average: 7.4, overview: 'Another stub show.' },
  {
    id: 1402,
    name: 'Stub Origins TV',
    first_air_date: '2010-02-02',
    vote_average: 6.5,
    overview: 'A similar stub show.',
  },
];
// The second cast member of each title has no photo (profile_path null) to exercise the initials placeholder.
const MOVIE_CREDITS = {
  603: {
    cast: [
      { id: 1, name: 'Stub Actor One', character: 'Neo Stub', order: 0, profile_path: '/profile.png' },
      { id: 2, name: 'Stub Actor Two', character: 'Trinity Stub', order: 1, profile_path: null },
      { id: 3, name: 'Stub Actor Three', character: '', order: 2, profile_path: '/profile.png' },
    ],
    recommendations: [RELATED_MOVIES[0], RELATED_MOVIES[1], RELATED_MOVIES[2]],
    similar: [RELATED_MOVIES[3]],
  },
};
const SHOW_CREDITS = {
  1399: {
    cast: [
      { id: 11, name: 'Stub Lead', order: 0, profile_path: '/profile.png', roles: [{ character: 'Jon Stub' }] },
      { id: 12, name: 'Stub Support', order: 1, profile_path: null, roles: [{ character: 'Arya Stub' }] },
    ],
    recommendations: [RELATED_SHOWS[0], RELATED_SHOWS[1]],
    similar: [RELATED_SHOWS[2]],
  },
};
const SHOW_SEASONS = {
  1399: [{ season_number: 1, name: 'Season 1', episode_count: 4, poster_path: '/poster.png' }],
};
const SEASON_EPISODES = [
  {
    n: 1,
    name: 'Winter Stub',
    still: '/still.png',
    runtime: 58,
    overview: 'The stub family gathers at the stub castle.',
  },
  {
    n: 2,
    name: 'The Stub Road',
    still: '/still.png',
    runtime: 56,
    overview: 'A stub journey begins along the stub road.',
  },
  {
    n: 3,
    name: 'Lord Stub',
    still: '/still.png',
    runtime: 55,
    overview: 'Lord Stub makes a surprising stub decision.',
  },
  { n: 4, name: 'The Last Stub', still: null, runtime: 56, overview: 'An episode that has no still image.' },
];

const captured = { sentry: [], posthog: [], flagRequests: [] };
// Every TMDB and gateway request (path with query string), for checks that count upstream calls.
const requestLog = [];
// Query (trimmed, lower-case) -> milliseconds to hold back the `/search/multi` answer for it.
const searchDelays = new Map();
let featureFlags = {};

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
  const found = movie && [...MOVIES, ...RELATED_MOVIES].find((m) => m.id === Number(movie[1]));
  if (found) {
    return [
      200,
      {
        ...withArt(found),
        runtime: 136,
        genres: [{ id: 1, name: 'Stub' }],
        imdb_id: 'tt0000603',
        ...related(found.id, MOVIE_CREDITS, 'credits', searchParams),
      },
    ];
  }
  const show = /^\/tv\/(\d+)$/.exec(pathname);
  const foundShow = show && [...SHOWS, ...RELATED_SHOWS].find((s) => s.id === Number(show[1]));
  if (foundShow) {
    const seasons = SHOW_SEASONS[foundShow.id] ?? [];
    return [
      200,
      {
        ...withArt(foundShow),
        genres: [{ id: 1, name: 'Stub' }],
        external_ids: { imdb_id: 'tt0001399' },
        seasons,
        ...related(foundShow.id, SHOW_CREDITS, 'aggregate_credits', searchParams),
      },
    ];
  }
  const season = /^\/tv\/(\d+)\/season\/(\d+)$/.exec(pathname);
  if (season && SHOWS.some((s) => s.id === Number(season[1])) && Number(season[2]) === 1) {
    const episodes = SEASON_EPISODES.map((e) => ({
      episode_number: e.n,
      name: e.name,
      overview: e.overview,
      still_path: e.still,
      runtime: e.runtime,
      air_date: `2011-04-${16 + e.n}`,
    }));
    return [200, { season_number: 1, name: 'Season 1', episodes }];
  }
  return [404, { status_message: 'The resource you requested could not be found.' }];
}

/** Like TMDB's append_to_response: only the sections the request asked for are included; titles without data get empty ones. */
function related(id, table, creditsKey, searchParams) {
  const asked = (searchParams.get('append_to_response') ?? '').split(',');
  const data = table[id] ?? { cast: [], recommendations: [], similar: [] };
  const art = (list) => ({ results: list.map(withArt) });
  return {
    ...(asked.includes(creditsKey) ? { [creditsKey]: { cast: data.cast } } : {}),
    ...(asked.includes('recommendations') ? { recommendations: art(data.recommendations) } : {}),
    ...(asked.includes('similar') ? { similar: art(data.similar) } : {}),
  };
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

/** `GET /__requests` lists the logged upstream requests, `DELETE /__requests` clears them. Returns true when handled. */
function requestLogEndpoint(url, request, response) {
  if (url.pathname !== '/__requests') return false;
  if (request.method === 'DELETE') requestLog.length = 0;
  send(response, 200, request.method === 'DELETE' ? { ok: true } : { requests: requestLog });
  return true;
}

/**
 * `POST /__search-delays` with a JSON body such as `{"stub": 3000}` delays the `/search/multi` answer for that query
 * (compared trimmed and lower-case) by that many milliseconds; `DELETE /__search-delays` removes all delays. A
 * delayed answer is logged when it arrives, so the request log shows when the server asked. Returns true when handled.
 */
async function searchDelayEndpoint(url, request, response) {
  if (url.pathname !== '/__search-delays') return false;
  if (request.method === 'DELETE') searchDelays.clear();
  if (request.method === 'POST') {
    const delays = JSON.parse((await readBody(request)).toString('utf8') || '{}');
    for (const [query, ms] of Object.entries(delays)) searchDelays.set(query.trim().toLowerCase(), Number(ms));
  }
  send(response, 200, { delays: Object.fromEntries(searchDelays) });
  return true;
}

async function tmdbHandler(request, response) {
  const url = new URL(request.url ?? '/', `http://${HOST}`);
  if (requestLogEndpoint(url, request, response)) return;
  if (await searchDelayEndpoint(url, request, response)) return;
  if (url.pathname.startsWith('/img/')) return send(response, 200, PNG);
  requestLog.push({ upstream: 'tmdb', method: request.method, path: `${url.pathname}${url.search}` });
  if (url.pathname === '/search/multi') {
    const wait = searchDelays.get((url.searchParams.get('query') ?? '').trim().toLowerCase());
    if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
  }
  const [status, body] = tmdb(url);
  return send(response, status, body);
}

function gatewayHandler(request, response) {
  const url = new URL(request.url ?? '/', `http://${HOST}`);
  if (requestLogEndpoint(url, request, response)) return;
  requestLog.push({ upstream: 'gateway', method: request.method, path: `${url.pathname}${url.search}` });
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
      captured.flagRequests.length = 0;
      return send(response, 200, { ok: true });
    }
    return send(response, 200, captured);
  }
  if (url.pathname === '/__flags' && request.method === 'POST') {
    featureFlags = JSON.parse((await readBody(request)).toString('utf8') || '{}');
    return send(response, 200, { ok: true });
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
  const isFlags = url.pathname.startsWith('/flags') || url.pathname.startsWith('/decide');
  if (isFlags && body.length > 0) captured.flagRequests.push(body.toString('utf8'));
  if (!isFlags && request.method === 'POST' && body.length > 0) {
    try {
      captured.posthog.push(...decodePostHog(body));
    } catch {
      // not an event batch
    }
  }
  if (isFlags) return send(response, 200, { featureFlags, featureFlagPayloads: {}, errorsWhileComputingFlags: false });
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
