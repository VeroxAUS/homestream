# Runbook: profiling

Measure before you change anything. HomeStream has a performance-first rule: nothing may make Home render, remote focus, playback start or HLS segment serving noticeably slower. This runbook shows how to take numbers on the server and how to find where time goes.

## Symptoms

- Playback takes longer to start than it used to.
- Segments arrive late and the player rebuffers.
- Home or search feels slow, or the server process uses a lot of CPU or memory.
- A test run got slower.

## Diagnosis

1. **Decide which part is slow.** The start of a session is timed step by step. Run the server with debug logging and start a title; each step logs the milliseconds since the request:

   ```powershell
   $env:LOG_LEVEL = 'debug'; pnpm --filter @homestream/server start
   ```

   Read the lines in the console or with `curl.exe "http://localhost:8600/api/logs?source=session&limit=50"`. Compare the gateway lookup, the probe, the encoder start and the first segment.

2. **Look at a running session.** `GET /api/activity` lists every live session with its `encoder` stats (`fps`, `speed`, `bitrateKbps`, `headSegment`). A `speed` below 1.0 (1.0 is real time) means the encoder cannot keep up; a speed near 1.0 with a slow start points at the download instead. `GET /api/health` shows `gpu` load and `disk` space.

3. **Read the metrics.** `GET /metrics` is Prometheus text: request counts and durations per route, live sessions, encoder speed and restarts, gateway, TMDB and source proxy cache counters, plus process CPU, memory and event loop lag. Two scrapes a minute apart show rates:

   ```powershell
   curl.exe http://localhost:8600/metrics
   ```

   `GET /healthz` (process is up) and `GET /readyz` (database and data directory usable) are cheap probes. Every response carries an `X-Request-ID`; the same id is the `reqId` field of its lines in `server.log`.

4. **Profile the Node process** when the CPU is busy in the server itself. This starts a throw-away server on port 8602 with the V8 profiler, sends light traffic for eight seconds, stops it cleanly and writes the profile to `reports/profiles`:

   ```powershell
   pnpm profile:server
   ```

   Options: `--seconds=30` for longer traffic, `--port=8610` for another port (8600 to 8649). To profile your own server and workload, start it with `node --cpu-prof --cpu-prof-dir=reports/profiles dist/index.js` and stop it with Ctrl+C so the profile is written. Open the `.cpuprofile` file in Chrome DevTools (Performance tab, Load profile). For memory use `--heap-prof` the same way. Profiles can contain file paths; `reports/` is ignored by git, never commit them.

5. **Profile a test or the build.** `pnpm test:timing` lists the slowest tests from the last `pnpm test:report`. `pnpm build:summary` writes a turbo summary with the time per package.

6. **Download pacing.** Upstream downloads are capped by `MAX_DOWNLOAD_MBPS` and the encoder only reads `READ_AHEAD_SEC` ahead of the player (see [.env.example](../../.env.example)). A session that is slow to start with the cap set very low is behaving as designed.

## Fix

- Change one thing at a time and measure again with the same title, the same client and the same settings.
- Fix the biggest step first. Do not move work onto the playback path to speed up something else; telemetry, metrics and logging stay asynchronous and batched.
- Add a unit or integration test for the new behaviour so the regression is caught next time, and record the before and after numbers in the commit message.
- GPU or real-encode measurements need the GPU tier and an idle machine: follow the [homestream-live-tests skill](../../.factory/skills/homestream-live-tests/SKILL.md), and keep the bandwidth limit on.

## Verify

Repeat the measurement from a fresh server process (the first start after a restart is the slowest, include it). The numbers are better than before, `pnpm test:ci` passes, and `GET /api/health` is still `ok`.
