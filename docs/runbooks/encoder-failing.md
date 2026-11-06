# Runbook: encoder failing

The PC encodes every stream with ffmpeg and NVENC. When the encoder cannot start or keeps dying, a session ends with an error such as `encoder_failed` or `encoder_memory_limit`.

## Symptoms

- `POST /api/sessions` or `GET /api/sessions/{id}` returns `{error:{code:"encoder_failed", message, hint}}`.
- `GET /hls/{id}/{file}` answers with a `5xx` for a segment that never appears.
- The `ffmpeg` or `gpu` check in `GET /api/health` is `warn` or `error` (the GPU check warns when the card is hot).
- The log has `ffmpeg` entries: `GET /api/logs?source=ffmpeg&level=error`.

## Diagnosis

1. Run the checks fresh. The `ffmpeg` check tests that ffmpeg and ffprobe run, lists the NVENC encoders (`h264_nvenc`, `hevc_nvenc`) and runs a one-second test encode (turn that off with `HEALTH_NVENC_TEST=off`). The `gpu` check reports the GPU load and temperature.

   ```powershell
   curl.exe -X POST "http://localhost:8600/api/health/run?fresh=1"
   curl.exe "http://localhost:8600/api/logs?source=ffmpeg&limit=30"
   ```

2. Match the symptom:
   - **ffmpeg not found:** the check says so. Set `FFMPEG_PATH` and `FFPROBE_PATH` in `.env`, or put ffmpeg on `PATH`.
   - **NVENC unavailable:** the `ffmpeg` check's test encode fails. Update the NVIDIA driver, check that no other program has exhausted the encoder sessions of the card, and that the ffmpeg build has `h264_nvenc`.
   - **`encoder_memory_limit`:** the memory watchdog stopped an ffmpeg process above `FFMPEG_MAX_RSS_MB` (default 4096). Raise it, or find out why that title needs so much (software subtitle burn-in on a 4K source is the usual cause).
   - **`all_streams_failed`:** every candidate source failed to start, which is usually a source problem, not the encoder. The error lists each attempt; see [gateway-down](gateway-down.md).
   - **A game is running:** a game and the encoder compete for the GPU. Close the game or accept slower than real-time encoding.
   - **Only one title fails:** the source is broken. Try another stream for the same title.

3. Reproduce with the encoder tests when you have an NVIDIA GPU. They start real encoders: read the [homestream-live-tests skill](../../.factory/skills/homestream-live-tests/SKILL.md) first and run them alone.

## Fix

- Fix the cause above, then restart the server if you changed `.env`.
- Stop a session stuck in an error state: `curl.exe -X DELETE http://localhost:8600/api/sessions/{id}`.
- If ffmpeg processes are left over, follow [ffmpeg-orphans](ffmpeg-orphans.md).
- If a regression in the code is the cause, go back to the last good version with [rollback](rollback.md) and report it with the log lines from step 1 (redacted: no URLs, no keys).

## Verify

```powershell
curl.exe -X POST "http://localhost:8600/api/health/run?fresh=1"
```

The `ffmpeg` and `gpu` checks are `ok`. Start a title from a client; `GET /api/activity` shows the session and the first segment is served from `/hls/{id}/index.m3u8`.
