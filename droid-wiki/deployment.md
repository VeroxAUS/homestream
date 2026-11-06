# Running built HomeStream

The implemented delivery path is a local Node server plus optional built web assets. There is no checked-in installer, container deployment, service definition, or CI release pipeline. Begin with [getting started](overview/getting-started.md).

## Build and start

From the repository root:

```powershell
pnpm install
pnpm build
pnpm --filter @homestream/server start
```

`package.json` builds present workspaces recursively. `apps/server/package.json` builds shared contracts before compiling the server, then starts `node dist/index.js`. The web build emits `apps/web/dist`; shared emits JavaScript and declarations in `packages/shared/dist`.

`apps/server/src/index.ts` defaults web serving to the sibling `apps/web/dist`. `apps/server/src/routes/static.ts` only enables static serving when `index.html` exists. The browser app remains a placeholder; building it does not add a playback UI.

## Runtime preparation

Use Node with `node:sqlite` and `parseEnv`, pnpm for workspace commands, and FFmpeg/ffprobe with the hardware and filters required by the [encoding pipeline](systems/playback/encoding.md). Node 24.20.0 and pnpm 12.16.1 were observed locally, not pinned by the repository.

Set writable data/transcode directories and your own upstream credentials. [Configuration](reference/configuration.md) documents file selection, overrides, and defaults. Configuration changes require a restart.

The server binds publicly on `0.0.0.0:8600` by default; its source proxy binds loopback, normally port 8650. mDNS advertises `_homestream._tcp`; advertisement errors warn without disabling direct access. Keep exposure within a trusted LAN: there is no authentication or built-in TLS configuration.

## Shutdown and persistent state

Startup opens SQLite and logging, recovers orphan encoders, then starts listeners and discovery. SIGINT, SIGTERM, SIGBREAK, an IPC `{ type: "shutdown" }` message, or stdin `shutdown` trigger cleanup (`apps/server/src/index.ts`).

Retain the configured data directory for SQLite history/cache and logs. Transcode files are managed session output, not the durable catalog. Stop the server before taking a simple file-copy backup so SQLite/WAL state is consistent; no automated backup/restore workflow is implemented here.

`HOMESTREAM_PACKAGED=1` disables repository-root discovery, but is only a runtime switch—not evidence of a packaged deliverable. Verify operation through [monitoring](how-to-monitor.md), and apply the [security boundary](security.md).
