---
name: homestream-live-tests
description: Run the HomeStream GPU and live test tiers (real ffmpeg/NVENC encodes, real TMDB, gateway and TorBox calls) without hurting the machine, the network or the upstream services. Use only when a change needs real-world verification.
---

# Live and GPU tests

The unit and integration tiers cover almost everything and run anywhere (`pnpm test:ci`). The two real-world tiers do not run in CI and need care.

| Tier | Command          | Needs                         | Risk                                              |
| ---- | ---------------- | ----------------------------- | ------------------------------------------------- |
| gpu  | `pnpm test:gpu`  | ffmpeg with NVENC, NVIDIA GPU | Starts real encoders; uses GPU, CPU and disk      |
| live | `pnpm test:live` | `.env` keys, network          | Calls real TMDB, gateway and TorBox; rate limited |

Prefer extending the integration tier with a stub. Only use these tiers to confirm behaviour a stub cannot show (NVENC arguments, real container quirks, a real upstream response shape).

## Before you start

1. Ask the owner (or check) that no game or other GPU-heavy program is running and that the PC is idle. GPU tests compete with the user's own programs.
2. Check `.env` has the keys the live tests need (`GATEWAY_MANIFEST_URL`, `TMDB_READ_TOKEN`, optionally `TORBOX_API_KEY`) without printing them. Never paste, log or commit a value.
3. Check the baseline is green: `pnpm test:ci`.
4. Make sure no ffmpeg process from an earlier run is left over ([ffmpeg-orphans runbook](../../../docs/runbooks/ffmpeg-orphans.md)).

## Rules while they run

- **One test file at a time.** Run a single file, wait for it to finish, then the next:

  ```powershell
  pnpm --filter @homestream/server exec vitest run --project gpu test/encode
  pnpm --filter @homestream/server exec vitest run --project live test/live
  ```

  Narrow the path to one file when you can. Do not run the tiers in parallel with each other or with other heavy commands.

- **Limit the bandwidth.** The household shares one connection. When you start the server for a real-title check, set `MAX_DOWNLOAD_MBPS=60` or lower (the minimum is 5), and never download a whole file for a test.
- **Few gateway requests.** The gateway allows about 5 requests per 5 seconds. Real calls belong only in `apps/server/test/live/`, and each file should make as few as possible.
- **Ports 8600 to 8699 only.** Tests use port 0 (a random free port). A server you start by hand uses 8600.
- **Stop gently.** End a session with `DELETE /api/sessions/{id}` (no body, no content-type), wait a few seconds, then stop the server by process id. Never stop processes by name and never leave ffmpeg running.
- **Temporary data** goes under `HOMESTREAM_TEST_ROOT` (see [.env.example](../../../.env.example)) through `makeTempDir()`; remove it at the end.

## After

1. Confirm `Get-CimInstance Win32_Process -Filter "Name = 'ffmpeg.exe'"` lists no leftover ffmpeg from your run, and the server you started is stopped.
2. Run `pnpm test:ci` again to confirm nothing regressed.
3. Report which files you ran and the result. Keep real URLs, keys and titles out of the report and of any fixture you add.
