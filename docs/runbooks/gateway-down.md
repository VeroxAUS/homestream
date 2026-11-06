# Runbook: gateway down

The AIOStreams gateway answers the "what streams exist for this title" question. Without it, search results still work (they come from TMDB) but no title can start.

## Symptoms

- Starting playback fails with a gateway error (the response body is `{error:{code,message,hint}}` with a plain-English hint).
- `GET /api/streams/movie/{tmdbId}` returns an error or no streams for titles that worked before.
- The `gateway` check in `GET /api/health` is `warn` or `error`.
- The event log has gateway entries: `GET /api/logs?source=gateway&level=error`.

## Diagnosis

1. Read the check and its hint:

   ```powershell
   curl.exe -X POST "http://localhost:8600/api/health/run?fresh=1"
   ```

   `fresh=1` skips the cache and asks the gateway now. The `gateway` entry says whether the manifest URL is missing, unreachable, rate limited or answering with an error.

2. Read the last gateway events:

   ```powershell
   curl.exe "http://localhost:8600/api/logs?source=gateway&limit=30"
   ```

3. Tell apart the three common causes:
   - **The gateway host is down or unreachable** (timeouts, connection refused). Open the manifest URL from `.env` in a browser on the same PC. Do not paste the URL anywhere else, it embeds your configuration.
   - **The manifest URL changed or was regenerated** (the check reports a rejected or unknown manifest). Create the manifest again in the AIOStreams configuration page and copy the new URL.
   - **Rate limiting** (the gateway allows about 5 requests per 5 seconds). The server spaces requests itself; if the log shows limit errors, something else is sharing the gateway, or a test is running against it (`pnpm test:live`). Stop it and wait a minute.

## Fix

- Gateway down: wait, or point `GATEWAY_MANIFEST_URL` at a working gateway instance. Titles whose streams are already cached by the server keep working until the cache expires.
- Wrong or old manifest: put the new URL into `GATEWAY_MANIFEST_URL` in `.env` (or `%APPDATA%\HomeStream\config.env` for the packaged app) and restart the server. Nothing needs to be rebuilt.
- Rate limited: stop whatever else is calling the gateway and retry after a minute.

## Verify

```powershell
curl.exe -X POST "http://localhost:8600/api/health/run?fresh=1"
```

The `gateway` check is `ok` and names the gateway add-on. Then start a title from a client, or `curl.exe http://localhost:8600/api/streams/movie/278` and confirm streams come back.
