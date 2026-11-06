// Preloaded into the server under test (NODE_OPTIONS=--import): TMDB has a fixed base URL, so its calls are pointed at the
// stub, and any other request that would leave the machine is refused. The e2e run can therefore never reach a real service.
const TMDB_BASE = 'https://api.themoviedb.org/3';
const stub = process.env.E2E_TMDB_ORIGIN;
const realFetch = globalThis.fetch;

function urlOf(input) {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.href : input.url;
}

globalThis.fetch = (input, init) => {
  const url = urlOf(input);
  if (stub && url.startsWith(TMDB_BASE)) return realFetch(stub + url.slice(TMDB_BASE.length), init);
  const host = new URL(url).hostname;
  if (host !== '127.0.0.1' && host !== 'localhost')
    return Promise.reject(new Error(`e2e: outbound request to ${host} blocked`));
  return realFetch(input, init);
};
