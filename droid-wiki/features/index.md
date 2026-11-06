# Features

Active contributors: VeroxAUS

## Purpose

These pages describe implemented server capabilities, not completed client screens. The [web app](../apps/web.md) is still a placeholder; `apps/server/src/app.ts` composes the services behind the API.

## Capability map

| Capability                               | Main abstraction                                                 | Behavior                                                                |
| ---------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------- |
| [Catalog](catalog.md)                    | `HomeService`, `apps/server/src/home/service.ts`                 | Metadata, search, home rows, featured banner and recommendations        |
| [Stream selection](stream-selection.md)  | `StreamService`, `apps/server/src/streams/service.ts`            | URL-free discovery, cached-first ranking and automatic-start candidates |
| [Prefetch](prefetch.md)                  | `PrefetchService`, `apps/server/src/prefetch/service.ts`         | Flag-gated source/probe warming without a session                       |
| [Downloads](downloads.md)                | `DownloadService`, `apps/server/src/downloads/service.ts`        | Persistent tracking when TorBox must cache a title first                |
| [Viewing progress](viewing-progress.md)  | `ContinueWatchingService`, `apps/server/src/progress/service.ts` | Resume state, next episode, history and statistics                      |
| [Playback](../systems/playback/index.md) | `PlaybackManager`, `apps/server/src/playback/manager.ts`         | Probing, device decisions, encoding, HLS and subtitles                  |

## Main flow

Catalog metadata supplies an IMDb identity for [gateway](../systems/gateway.md) discovery. The stream service ranks candidates for a device's display tier. Prefetch can warm the recommended cached source; Play either starts an encoded session or returns a tracked download. Progress pings feed continue watching, history and Home recommendations (`apps/server/src/tmdb/service.ts`, `apps/server/src/streams/rank.ts`, `apps/server/src/playback/manager.ts`, `apps/server/src/home/service.ts`).

The [source proxy](../systems/source-proxy.md) owns shared media bytes; persistent TorBox tracking is a different feature and does not download the whole movie to the PC.

## Modification entry points

Change pure rules in the feature's domain directory, orchestration in its service, HTTP validation in `apps/server/src/routes/`, and cross-runtime shapes in [shared](../packages/shared.md). See [API](../api/index.md) for route contracts and [testing](../how-to-contribute/testing.md) for offline versus opt-in suites.

## Key source files

| File                                   | Purpose                         |
| -------------------------------------- | ------------------------------- |
| `apps/server/src/app.ts`               | Feature composition             |
| `apps/server/src/home/service.ts`      | Home orchestration              |
| `apps/server/src/streams/rank.ts`      | Selection policy                |
| `apps/server/src/prefetch/service.ts`  | Speculative warming             |
| `apps/server/src/downloads/service.ts` | Persistent upstream tracking    |
| `apps/server/src/progress/service.ts`  | Continue-watching orchestration |
| `apps/server/src/stats/aggregate.ts`   | History-derived statistics      |

## Measured scope

The `apps/server/src/` directories `tmdb`, `home`, `streams`, `prefetch`, `downloads`, `progress` and `stats` contain **20 tracked TypeScript source files**. Matching directories under `apps/server/test/` contain **12 test files**, a **0.60 test-to-code file ratio**. This narrow count excludes routes, DB helpers, shared contracts, playback, integration, GPU and live tests; those still exercise these features. Default-branch history has **1 unique human author**, VeroxAUS, excluding bots.
