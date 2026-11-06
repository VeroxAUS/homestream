# Runbook: transcode drive full

While a session plays, ffmpeg writes HLS segments into `TRANSCODE_DIR`. The server keeps that folder below `TRANSCODE_MAX_GB` by parking the encoder and trimming segments the player has passed. If the drive itself runs out of space, ffmpeg cannot write and the session fails.

## Symptoms

- Playback stalls or ends, and `GET /api/sessions/{id}` shows the session in an error state.
- The `disk` check in `GET /api/health` is `warn` (under 20 GB free) or `error` (under 5 GB free) and names the drive.
- The event log has `ffmpeg` or `session` errors about writing segments: `GET /api/logs?level=error&limit=50`.
- The SQLite database cannot be written (the `DATA_DIR` drive is full), and history or progress stop updating.

## Diagnosis

```powershell
curl.exe -X POST "http://localhost:8600/api/health/run?fresh=1"
curl.exe http://localhost:8600/api/activity
Get-PSDrive -PSProvider FileSystem
```

The `disk` check reports free space per drive, the current size of the transcode cache and `transcodeMaxGb`. Check which of these is true:

- **Cache over its limit, drive has room:** the cap (`TRANSCODE_MAX_GB`, default 20) is lower than what long sessions need. The server trims on its own; this only warns.
- **Drive nearly full because of other files:** the transcode folder is small, the drive is not. Free space elsewhere or move `TRANSCODE_DIR` and `DATA_DIR`.
- **Leftover session folders** from a crash. The server removes them on its next start (see [ffmpeg-orphans](ffmpeg-orphans.md)).

## Fix

1. Stop the sessions that are using space gently: `curl.exe -X DELETE http://localhost:8600/api/sessions/{id}` for each id in `/api/activity`.
2. Free space on the drive, or point `TRANSCODE_DIR` (and `DATA_DIR` if it shares the drive) at a drive with more room in `.env`, then restart the server. Moving `TRANSCODE_DIR` needs no data migration, its content is disposable.
3. If you raise `TRANSCODE_MAX_GB`, keep it well below the free space of the drive.
4. Do not delete files inside `DATA_DIR` by hand (`homestream.db`, `ffmpeg-pids.json`). The database holds your watch progress.

## Verify

```powershell
curl.exe -X POST "http://localhost:8600/api/health/run?fresh=1"
```

The `disk` check is `ok` with more than 20 GB free. Start a title and confirm `GET /api/activity` shows the session playing and the transcode cache size stays under the limit.
