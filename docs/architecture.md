# Architecture

HomeStream is one Node.js process on a Windows PC (the server) plus thin clients on the local network. The server finds a source stream, re-encodes it with ffmpeg and NVENC, and serves HLS. Clients never talk to TMDB, the gateway or TorBox directly.

This document has six views: [components and deployment](#components-and-deployment), [playback](#playback-sequence), [source proxy and prefetch](#source-proxy-and-prefetch), [data model](#data-model), [desktop shell](#desktop-shell-appsdesktop), and [telemetry and CI/CD](#telemetry-and-cicd). The HTTP surface is in [openapi.json](openapi.json) (also served at `/api/docs`), the tables are in [database.md](database.md).

## Components and deployment

```mermaid
flowchart LR
  subgraph LAN["Local network"]
    TV["Google TV app"]
    Desktop["Desktop shell (Electron)"]
    Browser["Web UI (browser)"]
  end

  subgraph PC["Windows PC (one process, port 8600)"]
    API["Fastify API<br/>/api/* and /hls/*"]
    Static["Static web UI<br/>(SPA fallback)"]
    Playback["Playback manager<br/>decision engine, sessions"]
    Proxy["Source proxy<br/>(loopback only)"]
    Downloads["Downloads queue"]
    Health["Health checks"]
    DB[("SQLite<br/>homestream.db")]
    Segments[/"Transcode dir<br/>HLS segments"/]
    FFmpeg["ffmpeg + NVENC<br/>(child processes)"]
  end

  subgraph Cloud["Internet"]
    TMDB["TMDB"]
    Gateway["AIOStreams gateway"]
    CDN["Stream CDN"]
    TorBox["TorBox"]
    Sentry["Sentry"]
    PostHog["PostHog"]
  end

  TV --> API
  Desktop --> API
  Browser --> Static
  Browser --> API
  API --> Playback
  API --> Downloads
  API --> Health
  API --> DB
  Playback --> Proxy
  Playback --> FFmpeg
  FFmpeg --> Proxy
  FFmpeg --> Segments
  API -->|serves| Segments
  Proxy --> CDN
  API --> TMDB
  API --> Gateway
  Downloads --> TorBox
  Health --> Gateway
  Health --> TorBox
  Health --> TMDB
  API -.->|optional| Sentry
  API -.->|optional| PostHog
```

Key points:

- **One process.** The API, the web UI, the playback manager, the downloads queue and the health checks live in the same Node.js process. ffmpeg runs as child processes whose pids are recorded in `ffmpeg-pids.json`, so a crashed server's orphans are stopped on the next start (see [ffmpeg-orphans](runbooks/ffmpeg-orphans.md)).
- **The PC encodes everything.** Video is always re-encoded; clients always request `streamId: "auto"`. The decision engine picks the source, the encoder settings and what to burn in.
- **Local network only.** The server has no accounts and no authentication. Do not expose port 8600 to the internet. The source proxy listens on loopback only.
- **Ports.** Server 8600, web dev server 8601, source proxy `PORT + 50` by default (see [.env.example](../.env.example)).
- **Telemetry is optional.** Without Sentry or PostHog keys nothing leaves the machine except upstream requests the product needs ([PRIVACY.md](PRIVACY.md)).

## Playback sequence

```mermaid
sequenceDiagram
  autonumber
  participant C as Client
  participant A as API
  participant S as Streams service
  participant G as Gateway
  participant P as Source proxy
  participant M as Playback manager
  participant F as ffmpeg

  C->>A: GET /api/movie/{tmdbId} (details)
  C->>A: POST /api/sessions {type, tmdbId, streamId: "auto", capabilities}
  A->>S: resolve streams
  S->>G: query sources (cached, rate limited)
  G-->>S: candidate streams
  S-->>A: ranked streams
  A->>M: start session
  M->>P: register source (size, head and tail load)
  M->>P: ffprobe through loopback URL
  M->>M: decision engine (encoder settings, tracks, burn-in)
  M->>F: start encode at segment 0
  A-->>C: 201 {sessionId, hlsUrl, tracks}
  C->>A: GET /hls/{id}/index.m3u8
  A-->>C: master playlist
  loop each segment
    C->>A: GET /hls/{id}/seg-N
    A->>M: serve(seg-N)
    F->>P: read input bytes
    F-->>M: seg-N written
    A-->>C: segment
  end
  C->>A: POST /api/sessions/{id}/progress {positionSec}
  Note over C,F: Seek far ahead of the encoder
  C->>A: GET /hls/{id}/seg-900
  A->>M: serve(seg-900)
  M->>M: segment is beyond the seek window
  M->>F: stop encoder
  M->>F: restart encoder at segment 900
  F-->>M: seg-900 written
  A-->>C: segment
  C->>A: DELETE /api/sessions/{id}
  A->>M: stop
  M->>F: stop encoder, remove segments
```

When the title has no cached stream the start request answers `202` with a download status instead of a session; the client polls [`GET /api/downloads`](runbooks/torbox-expired.md) until the title is ready and starts again. A seek inside the window already encoded is served from disk. A seek more than five segments ahead of the encoder (or behind what was already deleted) stops the encoder and restarts it at the requested segment, which is why the first segment after a long seek takes a moment.

## Source proxy and prefetch

```mermaid
flowchart TD
  Start(["Session start or POST /api/prefetch"]) --> Register["Register source with the proxy<br/>(owner = session id or prefetch)"]
  Register --> Size["Ask upstream for the file size"]
  Size --> Warm["Load head and tail blocks in the background"]
  Warm --> Probe["ffprobe once per source<br/>(result cached and shared)"]
  Probe --> Encoder["ffmpeg reads http://127.0.0.1:{proxy port}/..."]
  Encoder --> Range{"Range request"}
  Range -->|all bytes cached| Mem["Serve from block cache"]
  Range -->|missing blocks| Pace["Pacer: global MAX_DOWNLOAD_MBPS"]
  Pace --> Gate{"Encoder lead over player<br/>above READ_AHEAD_SEC?"}
  Gate -->|yes| Hold["Hold reads until the lead drops<br/>below READ_AHEAD_RESUME_SEC"]
  Hold --> Gate
  Gate -->|no| Up["Ranged upstream read from the CDN"]
  Up -->|link expired or 4xx/5xx| Refresh["Re-resolve the gateway link<br/>(at most one log entry per 30 s)"]
  Refresh --> Up
  Up --> Cache["Store in the block cache"]
  Cache --> Mem
  Mem --> Encoder
  Cache --> Evict["LRU eviction: blocks behind the<br/>player position go first"]
```

The proxy hides expiring CDN links from ffmpeg: ffmpeg only ever sees a stable loopback URL. Several readers of one source (the encoder, subtitle extractors, a prefetch) share one block cache, and a reader that needs bytes just ahead of another stream's position waits for them instead of downloading twice. All upstream bytes pass through one pacer so the household connection is never saturated. Prefetch keeps only the newest few sources nobody plays yet.

## Data model

```mermaid
erDiagram
  devices ||--o{ plays : "device_id"
  plays ||--o{ events : "session_id"
  progress ||--o{ plays : "media_key"
  progress ||--o{ pending_downloads : "media_key"

  devices {
    TEXT id PK
    TEXT name
    TEXT kind
    TEXT capabilities
    TEXT last_ip
    INTEGER last_seen
  }
  plays {
    INTEGER id PK
    TEXT session_id UK
    TEXT media_key
    TEXT device_id
    INTEGER started_at
    INTEGER ended_at
    REAL watched_sec
    TEXT status
  }
  progress {
    TEXT media_key PK
    INTEGER tmdb_id
    REAL position_sec
    REAL duration_sec
    INTEGER completed
    INTEGER hidden
  }
  events {
    INTEGER id PK
    INTEGER ts
    TEXT level
    TEXT source
    TEXT message
    TEXT session_id
  }
  pending_downloads {
    TEXT id PK
    TEXT media_key
    TEXT status
    TEXT state
    REAL progress
    INTEGER next_poll_at
  }
  tmdb_cache {
    TEXT key PK
    TEXT json
    INTEGER expires_at
  }
  gateway_cache {
    TEXT key PK
    TEXT json
    INTEGER expires_at
  }
  settings {
    TEXT key PK
    TEXT value
    INTEGER updated_at
  }
```

The relations are logical: the schema has no foreign keys, so deleting a device or a progress row never cascades. `tmdb_cache` and `gateway_cache` are standalone key/value caches with an expiry, and `settings` is a standalone key/value table for the server's own state, such as the anonymous install id. The exact columns are in [schema.sql](schema.sql), with a description of every table in [database.md](database.md).

## Desktop shell (apps/desktop)

The Electron shell is a thin window around the web UI. It never talks to TMDB, the gateway or TorBox, and it does not encode anything: it starts (or attaches to) the server, loads `http://127.0.0.1:8600/` and reports its own errors.

```mermaid
flowchart LR
  subgraph Shell["Electron app (apps/desktop)"]
    Main["Main process<br/>window, tray, server start,<br/>@sentry/electron (process=main)"]
    Renderer["Renderer<br/>the web UI (apps/web)<br/>@sentry/react (process=renderer)"]
    Main --- Renderer
  end
  Server["HomeStream server<br/>:8600"]
  Sentry["Sentry<br/>homestream-web"]
  PostHog["PostHog"]

  Renderer -->|"/api, /hls, X-Request-ID"| Server
  Main -->|"spawn or attach"| Server
  Main -.->|"errors, scrubbed"| Sentry
  Renderer -.->|"errors, scrubbed"| Sentry
  Main -.->|"desktop_started"| PostHog
  Renderer -.->|"page_viewed"| PostHog
```

- The renderer is the same build of `apps/web` that browsers get; it detects the shell through `window.homestream.isDesktop` (set by the preload script) and tags its events `device.kind=desktop`.
- Both processes report to the Sentry project `homestream-web` through the same scrubber from `packages/shared`, tagged `process=main` or `process=renderer`. Without `SENTRY_DSN_WEB` and `POSTHOG_API_KEY`, or with `HOMESTREAM_TELEMETRY=off`, nothing is sent.
- `apps/web` and `apps/desktop` never import each other (dependency-cruiser enforces it); they share only `@homestream/shared`.
- The desktop dev workflow, the Electron cache location and the main-process telemetry plan are in [apps/desktop/README.md](../apps/desktop/README.md).

## Telemetry and CI/CD

```mermaid
flowchart LR
  subgraph Dev["Developer machine"]
    Commit["git commit"] --> Hooks["lefthook pre-commit:<br/>prettier, eslint, secret scan,<br/>large files, agents:check, docs:check"]
    Hooks --> Push["git push"]
  end

  subgraph CI["GitHub Actions"]
    Quality["format, lint, typecheck,<br/>knip, dup, deps, syncpack, techdebt"]
    Tests["test:ci with retries,<br/>coverage thresholds"]
    Docs["openapi:check, db:schema:check,<br/>docs:check, agents:check"]
    Build["build all apps,<br/>bundle budgets (size-limit)"]
    E2E["Web e2e (Playwright, Chromium):<br/>built UI + isolated server + stub upstreams"]
    Quality --> Tests --> Build
    Docs --> Build
  end

  Push --> Quality
  Push --> Docs
  Push --> E2E
  Build --> Release["Release artifacts,<br/>source maps to Sentry"]

  subgraph Runtime["Running apps"]
    Server["Server"]
    Web["Web UI / desktop"]
    TV["TV app"]
  end

  Release --> Runtime
  Server -->|"errors, scrubbed"| Sentry["Sentry"]
  Web -->|"errors, scrubbed"| Sentry
  TV -->|"errors, scrubbed"| Sentry
  Server -->|"typed events only"| PostHog["PostHog"]
  Web -->|"typed events only"| PostHog
  TV -->|"typed events only"| PostHog
  Switch{{"HOMESTREAM_TELEMETRY=off<br/>or no key set"}} -.->|disables| Sentry
  Switch -.->|disables| PostHog
```

Everything sent to Sentry passes through the scrubber (`redact()` and a beforeSend filter) and everything sent to PostHog is a typed event whose properties are allow-listed. Both are no-ops when their key is missing. The event catalog and exactly what each event contains are in [PRIVACY.md](PRIVACY.md). The quality gates are listed in [AGENTS.md](../AGENTS.md#ci-checks), failure handling in [sentry-triage](runbooks/sentry-triage.md) and [flaky-tests](runbooks/flaky-tests.md).
