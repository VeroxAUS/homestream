# Runbook: ffmpeg orphans

The server starts one ffmpeg per playing session (plus short-lived ffprobe and subtitle extractor processes) and records their process ids in `ffmpeg-pids.json` in `DATA_DIR`. A clean shutdown stops them. After a crash or a forced kill they can keep running and hold the GPU, memory and segment files.

## Symptoms

- `ffmpeg.exe` processes are running but `GET /api/activity` lists no sessions.
- GPU load or memory stays high after you stopped playback.
- New sessions start slowly or the transcode folder keeps growing with directories of sessions nobody plays.

## Diagnosis

1. See what the server believes is running:

   ```powershell
   curl.exe http://localhost:8600/api/activity
   ```

2. List the ffmpeg processes with their command lines (the session id is part of the playlist path):

   ```powershell
   Get-CimInstance Win32_Process -Filter "Name = 'ffmpeg.exe'" | Select-Object ProcessId, CreationDate, CommandLine
   ```

3. A process whose session id is not in `/api/activity` is an orphan. If the server is down, every ffmpeg that was started by it is an orphan. Do not touch ffmpeg processes that belong to other programs: check the command line before you stop one.

## Fix

- **Restart the server.** On startup it reads `ffmpeg-pids.json`, stops every process it recorded (only after checking the command line still contains the session id, so a reused pid is never killed), and deletes the leftover segment directories in `TRANSCODE_DIR`. This is the normal fix.
- **Server cannot start:** stop the orphans by process id, one at a time, then start the server:

  ```powershell
  Stop-Process -Id 12345
  ```

  Replace `12345` with a `ProcessId` from step 2. Never stop processes by name, and never stop one you have not identified.

- **Stop a live session gently** instead of killing it: `curl.exe -X DELETE http://localhost:8600/api/sessions/{id}` (no body, no content type), then wait a few seconds. The server stops the encoder and removes the segments.

## Verify

```powershell
curl.exe "http://localhost:8600/api/logs?source=session&limit=20"
Get-CimInstance Win32_Process -Filter "Name = 'ffmpeg.exe'" | Select-Object ProcessId, CommandLine
```

The startup log line reports how many orphans were stopped. The process list shows only ffmpeg processes that belong to sessions in `/api/activity` (none when nothing plays). `GET /api/health` shows the `sessions` check as `ok`.
