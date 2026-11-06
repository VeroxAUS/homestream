# Debugging

Start with the failing boundary: configuration, HTTP contract, upstream discovery, or local media processing. Use [monitoring](../how-to-monitor.md) for available evidence and [API](../api/index.md) for actual routes.

## Startup and connectivity

`apps/server/src/index.ts` logs configuration warnings, recovers orphan encoders, starts the loopback proxy, then starts the public listener. Check stdout and `server.log` under the configured data directory. A missing required key warns at startup rather than preventing the listener from opening; successful `/api/info` therefore does not prove TMDB or gateway access works.

Verify the chosen configuration file and restart after editing it. Nonblank process values override file values. Invalid port/size values can fall back with warnings; consult `apps/server/src/config.ts`.

The public listener defaults to 8600 on all interfaces. The proxy normally uses 8650 on loopback and falls back to a free port if occupied (`apps/server/src/sourceproxy/proxy.ts`). mDNS failure is best effort: direct address access can still work. Vite's hard-coded proxy target remains 8600 if you change the server port.

## Playback failures

Inspect `GET /api/sessions/:id`, `GET /api/activity`, and live session/log events. Compare the selected device capability profile, output decision, track indices, and encoder stats. Check FFmpeg/ffprobe availability and supported encoders/filters before blaming network discovery.

A far HLS segment request can restart encoding at that position. Track PATCH is not a seek/progress endpoint; audio or burn-in changes can also restart the encoder. Subtitle playlists can exist before extraction catches up; follow returned track status and retry behavior rather than treating a temporarily unavailable segment as an empty subtitle file.

`apps/server/src/playback/manager.ts` limits sessions to four by default, uses a 30-second media-segment wait, and stops idle sessions after two minutes. Disk-cap housekeeping can evict output or park/restart encoding.

## Reproduce safely

Prefer a focused stub-based test before live credentials or media. Unexpected server errors return a generic envelope while details go to logs (`apps/server/src/app.ts`). Share redacted errors and reproducible inputs, not the database, raw gateway response, signed URLs, or personal configuration. See [testing](testing.md).
