# Runbook: TorBox expired or rejected

TorBox is used for two things: the `torbox` health check, and caching titles that have no cached stream (the downloads queue). Playing titles the gateway already lists as cached does not need TorBox.

## Symptoms

- The `torbox` check in `GET /api/health` is `warn` or `error`, with a hint such as "TorBox subscription expired" or "TorBox rejected the API key".
- Starting an uncached title answers `202` with `{status:"downloading", download}`, but the entry in `GET /api/downloads` never reaches `ready`, or ends as `failed`.
- The event log shows `torbox` or `downloads` errors: `GET /api/logs?source=torbox&level=error`.

## Diagnosis

1. Run the check fresh and read the hint:

   ```powershell
   curl.exe -X POST "http://localhost:8600/api/health/run?fresh=1"
   ```

2. Look at the queue:

   ```powershell
   curl.exe http://localhost:8600/api/downloads
   ```

   Each entry has a `status` (`pending`, `ready`, `failed`), a `state`, a `progress` fraction from 0 to 1 and, for failures, a `reason` (`torbox_error`, `vanished`, `metadata_stuck`, `stalled` or `timeout`).

3. Decide which case you are in:
   - **No key** (`TORBOX_API_KEY` empty): the check says the account cannot be checked. Cached playback still works.
   - **Key rejected**: the key was regenerated or mistyped.
   - **Subscription expired**: the key is valid but the plan is not active.
   - **Download stuck**: the key and plan are fine, but TorBox does not have the torrent (no seeders, still queued on their side). The queue gives up and marks the entry `failed` with a reason that says why:
     - `vanished`: TorBox has not listed the item for 10 minutes (counted from the first poll that missed it). The add may never have registered, or TorBox dropped the item.
     - `metadata_stuck`: the item stayed in TorBox's metaDL state (looking up the torrent's files) for 30 minutes without progress.
     - `stalled`: no seeds and no progress for 6 hours. `timeout`: 24 hours passed without a cached stream.
     - `torbox_error`: TorBox itself reported a problem.
       Each failure shows up once as a `download.failed` notification and one warning line under the `downloads` log source. A title whose gateway request timed out is logged as `Sent "<title>" to TorBox, but it did not confirm in time; HomeStream will keep checking.` and stays `pending` until TorBox lists it or one of these limits passes. Playing the title again starts a new download.

## Fix

- Key missing or rejected: create a key in the TorBox settings, set `TORBOX_API_KEY` in `.env` (or `%APPDATA%\HomeStream\config.env`), restart the server.
- Subscription expired: renew it at torbox.app. No restart is needed; run the health check again.
- Failed or stuck download: remove it so a later attempt starts clean, then pick another title or source:

  ```powershell
  curl.exe -X DELETE http://localhost:8600/api/downloads/{id}
  ```

  Use the `id` from `GET /api/downloads`.

## Verify

```powershell
curl.exe -X POST "http://localhost:8600/api/health/run?fresh=1"
```

The `torbox` check is `ok` and shows the plan. For a stub TorBox in development, the API origin can be overridden with `TORBOX_API_URL` (see [.env.example](../../.env.example)); the integration tests use that seam, so you never need a live account to test the queue.
