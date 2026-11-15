# Architecture

HomeStream runs a Fastify server, FFmpeg child processes, and thin LAN clients. `apps/server/src/app.ts` constructs services; `apps/server/src/index.ts` starts listeners and workers. The browser and Electron renderer share the web build, while the desktop main process supervises the server (`apps/web/src/main.tsx`, `apps/desktop/src/main.ts`).

```mermaid
graph LR
    Browser[React browser UI] -->|API and SSE| API[Fastify server]
    Desktop[Electron shell] -->|spawn or attach| API
    API --> Catalog[Catalog and home]
    Catalog --> TMDB[TMDB]
    API --> Streams[Stream selection]
    Streams --> Gateway[AIOStreams gateway]
    API --> Playback[Playback manager]
    API --> Downloads[Download tracker]
    Downloads --> TorBox[TorBox]
    Playback --> Proxy[Loopback source proxy]
    Proxy --> CDN[Upstream media]
    Playback --> Encoder[FFmpeg and NVENC]
    Encoder -->|local source URL| Proxy
    Encoder --> HLS[HLS files]
    API -->|serves| HLS
```

## Runtime boundaries

The public listener defaults to port 8600 on all interfaces; the source proxy binds only to loopback, normally on 8650. The API has no authentication. Device registration records capabilities (`apps/server/src/config.ts`, `apps/server/src/sourceproxy/proxy.ts`, `apps/server/src/routes/devices.ts`). See [security](../security.md).

SQLite uses built-in `node:sqlite`, WAL, prepared statements, and numbered transactional migrations. HLS segments live separately under the transcode directory (`apps/server/src/db/index.ts`, `apps/server/src/db/migrations.ts`, `apps/server/src/playback/segmentStore.ts`). See [data models](../reference/data-models.md).

## Playback flow

```mermaid
sequenceDiagram
    participant C as Web player
    participant A as API
    participant M as Playback services
    participant P as Source proxy
    participant F as FFmpeg
    C->>A: POST /api/sessions with streamId auto
    A->>M: Validate shared schema and start
    M->>M: Rank candidates for device capabilities
    M->>P: Register, warm bytes, and probe
    M->>F: Encode through stable loopback URL
    M-->>A: Session with HLS URLs and tracks
    A-->>C: 201 session
    C->>A: Request playlists and segments
    A->>M: Serve or restart at seek
    F-->>M: Segment available
    A-->>C: Media bytes
    C->>A: Progress pings, including while paused
    C->>A: DELETE session when leaving
```

The session request can instead return `202` with download tracking when no cached source is playable. A gateway downloading placeholder is never a valid movie. Prefetch warms source bytes and probe results without encoding (`apps/server/src/routes/sessions.ts`, `apps/server/src/playback/sessionStart.ts`, `apps/server/src/playback/placeholder.ts`, `apps/server/src/prefetch/service.ts`).

A `202` response does not always confirm a remote download: state `pending` means the start probe timed out, while `downloading` means the gateway confirmed it or TorBox listed it. The tracker persists absence and metadata-lookup timers so restart cannot reset those failure windows (`packages/shared/src/downloads.ts`, `apps/server/src/downloads/service.ts`, `apps/server/src/db/migrations.ts`). See [downloads](../features/downloads.md).

`PlaybackManager` is a facade over shared context, session slots, startup, encoder lifecycle, recovery, subtitle handoff, and HLS serving. Slot ownership remains held when an encoder fails to exit, preventing a replacement from overcommitting the machine (`apps/server/src/playback/manager.ts`, `apps/server/src/playback/sessionSlots.ts`, `apps/server/src/playback/stuckStop.ts`). See [playback](../systems/playback/index.md).

Read-ahead pacing closes source reads using an anticipated lead that includes recent encoder speed and in-flight input, but reopens using the actual lead. For middle-file subtitle reads, the configured byte-gap hold distance is capped at 16 MiB ahead of their own encoder, reducing cached work that can hide renewed downloads (`apps/server/src/playback/readAheadPacing.ts`, `apps/server/src/network/readAhead.ts`, `apps/server/src/sourceproxy/proxy.ts`). See [network controls](../systems/network.md) and [source proxy](../systems/source-proxy.md).

## Workspaces and languages

| Workspace         | Responsibility                                                           |
| ----------------- | ------------------------------------------------------------------------ |
| `apps/server`     | API, persistence, upstream services, encoding, and monitoring            |
| `apps/web`        | React routes, HLS playback, Query cache, SSE, and desktop renderer views |
| `apps/desktop`    | Electron windows, tray, server supervisor, IPC, and mini player          |
| `packages/shared` | Zod contracts, desktop bridge, analytics catalog, flags, and sanitizers  |

TypeScript and TSX implement the runtimes, JavaScript ESM implements repository scripts, CSS styles the UI, and YAML configures automation. The committed inventory has 65,697 physical TypeScript lines, 9,953 TSX lines, 5,916 JavaScript lines, and 3,439 CSS lines, including tests, blanks, and comments. [By the numbers](../by-the-numbers.md#size) defines exclusions and distinguishes physical lines from code-only LOC. Workspace membership comes from `pnpm-workspace.yaml`; apps must not import each other (`.dependency-cruiser.cjs`). Desktop and web communicate through shared bridge types rather than cross-app imports (`packages/shared/src/desktop.ts`).

At `4a8eb2e`, the committed inventory contains 430 source files (38,633 physical lines) and 289 test/support files (46,189 lines), including root scripts. The four workspaces contribute 152 server, 165 web, 38 desktop, and 15 shared source files. This broad inventory includes CSS and development scripts; it is not a count of TypeScript modules or a test-coverage measurement. The linked statistics page defines exact exclusions.

Catalog details include bounded cast and recommendation arrays in the shared contract. The server normalizes the extra TMDB payload into the existing details response, rather than requiring an extra client request (`packages/shared/src/catalog.ts`, `apps/server/src/tmdb/normalize.ts`). Browser-only choices such as hiding unfinished episode spoilers live outside SQLite (`apps/web/src/lib/spoilers.ts`).

On a show-details cache miss, the same TMDB request also appends season 1. The server moves that section into its own season-cache row and removes it from the show row; the client still requests the existing season endpoint. Missing appended data or an expired season row falls back to the normal season request (`apps/server/src/tmdb/service.ts`). See [catalog](../features/catalog.md).

## Startup and shutdown

The server loads settings and logging, constructs services, recovers orphaned encoders, starts the proxy and public listener, then starts health checks, download polling, and mDNS. Signals, IPC, and stdin share bounded shutdown handling (`apps/server/src/index.ts`, `apps/server/src/app.ts`, `apps/server/src/shutdown.ts`).

The web entry point prefetches Home while loading its route. Device registration, SSE, and telemetry wait for the content mark and idle time. Sentry and PostHog imports stay out of the initial bundle (`apps/web/src/main.tsx`, `apps/web/src/lib/startup.ts`, `apps/web/src/telemetry/index.ts`). On SSE open, health is reconciled through the health query; pushed updates cancel older requests so late answers cannot overwrite newer state (`apps/web/src/events/serverEvents.ts`).

The desktop entry point acquires a single-instance lock, loads settings, and creates the shell and supervisor. It can attach to an existing server instead of owning a child; windows and quit behavior distinguish these cases (`apps/desktop/src/main.ts`, `apps/desktop/src/supervisor.ts`). See [desktop](../apps/desktop/index.md) and [network controls](../systems/network.md).
