# Shared

Active contributors: VeroxAUS

## Purpose

`@homestream/shared` is the cross-runtime contract and privacy layer. It exports Zod runtime schemas with inferred TypeScript types, plus pure sanitization, analytics and feature-flag helpers (`packages/shared/src/index.ts`).

## Contract layout

| Module                             | Boundary                                                                           |
| ---------------------------------- | ---------------------------------------------------------------------------------- |
| `packages/shared/src/schemas.ts`   | Devices, capability profiles, server info, event enums and error/attempt envelopes |
| `packages/shared/src/catalog.ts`   | Movie/show/season/episode metadata, featured banner and continue-watching shapes   |
| `packages/shared/src/streams.ts`   | URL-free discovery options and recommendations                                     |
| `packages/shared/src/playback.ts`  | Session start/patch/response, decisions, tracks, activity and prefetch             |
| `packages/shared/src/downloads.ts` | Download tracking, 202 response, details extensions and SSE payloads               |
| `packages/shared/src/progress.ts`  | Progress, resume/completion constants, history and statistics                      |
| `packages/shared/src/network.ts`   | Network snapshots and checks                                                       |
| `packages/shared/src/health.ts`    | Dependency health and check results                                                |
| `packages/shared/src/ops.ts`       | Liveness/readiness response shapes                                                 |
| `packages/shared/src/analytics.ts` | Typed product-event catalog, route templates and property validation               |
| `packages/shared/src/flags.ts`     | Flag registry, local defaults and remote-value coercion                            |
| `packages/shared/src/sanitize.ts`  | Text, object, breadcrumb and Sentry privacy filters                                |
| `packages/shared/src/identity.ts`  | Host/user word collection and whole-word scrubbing                                 |

`packages/shared/src/schemas.ts` bounds device identity/name, dimensions and audio channels. Device kinds describe capabilities, not authentication or shipped apps. Stream IDs are 16 lowercase hexadecimal characters; public stream metadata has no raw upstream URL (`packages/shared/src/streams.ts`).

TV start/prefetch bodies need season and episode. For subtitles, an omitted start selection applies the server default, `null` means Off, and an omitted patch selection means unchanged. A patch must change audio or subtitle selection (`packages/shared/src/playback.ts`). Session-start parsing accepts a bounded string ID, including `auto`; the client product rule is always to send `auto`, not to expose a manual picker.

Catalog and tracking contracts have server implementations: Home contains persisted continue watching and featured items, details can include pending downloads, and session creation returns either a session or a distinct downloading envelope. A schema does not imply a finished client screen: the browser player/dashboard remain placeholders and the desktop shell is not implemented. See [catalog](../features/catalog.md), [downloads](../features/downloads.md), [web](../apps/web/index.md) and [desktop](../apps/desktop.md).

The progress module shares the completion threshold of **0.92** and minimum resumable position of **60 seconds**, plus per-episode progress, history filtering/pagination, and summary/graph responses (`packages/shared/src/progress.ts`). Download wire states distinguish `pending`, `downloading`, `ready` and `failed`, while stored statuses collapse the first two into `pending` (`packages/shared/src/downloads.ts`). Network contracts distinguish a filling read-ahead window from `waiting`, when the encoder is ahead and its source reads stop (`packages/shared/src/network.ts`).

Health results have ordered check IDs and loose per-check details; the network module also exports a more specific network-check shape. Logs carry epoch-millisecond timestamps, whereas health measurement times are ISO strings (`packages/shared/src/health.ts`, `packages/shared/src/network.ts`). These are transport contracts, not SQLite row definitions; see [data models](../reference/data-models.md).

## Privacy and analytics

`sanitizeText` in `packages/shared/src/sanitize.ts` removes URL/token/address patterns and personal home prefixes, with a caller-supplied secret scrubber applied first. `sanitizeValue` in the same module deep-copies values, drops denied fields and stops repeated objects/deep recursion at depth 12. Its Sentry helper removes request/user data, trims identifying contexts and makes known-root stack paths relative. It then sets `sdk.settings.infer_ip: "never"` and an empty `user.geo` to suppress ingestion-side IP and location inference. This is pattern-based filtering, not a guarantee that arbitrary text or every absolute path is anonymous.

`ANALYTICS_EVENTS` in `packages/shared/src/analytics.ts` defines seven product events: `server_started`, `playback_started`, `playback_ended`, `playback_failed`, `page_viewed`, `desktop_started` and `prefetch_requested`. `sanitizeEventProperties` in the same module drops unknown events/properties and invalid values. Strings must survive scrubbing unchanged, except media titles may retain scrubbed text. Page views accept route templates from `PAGE_ROUTES`, not concrete paths or search text. Declaring `desktop_started` does not mean a desktop shell currently emits it. The catalog does not transmit events or initialize SDKs; those belong to [telemetry](../systems/telemetry.md).

## Identity boundaries

`identityWordsFrom` and `createWordScrubber` in `packages/shared/src/identity.ts` collect host/user names through an injected source, discard names shorter than three characters, and build a case-insensitive whole-word scrubber. They do **not** generate an install ID or device ID, and have no Node import.

The server's random analytics install ID is persisted in SQLite by `installId` in `apps/server/src/db/settings.ts`. Browser device identity and its editable local name come from `apps/web/src/device/identity.ts`; they describe capability registration, not analytics or authentication. Browser analytics uses separate SDK-managed persistence in `apps/web/src/telemetry/posthog.ts`. Never substitute a hostname, username or device display name for an analytics identifier.

## Feature flags

`packages/shared/src/flags.ts` is intentionally import-free because repository scripts load it directly. Its typed registry, key guard, default lookup and value coercion keep invalid/missing remote values on a local default:

| Flag                       | Status                                         | Default |
| -------------------------- | ---------------------------------------------- | ------- |
| `prefetch-on-details`      | Active server gate for speculative warming     | `true`  |
| `banner-rotation-interval` | Active browser experiment, variants `9s`/`12s` | `9s`    |

Both registry entries are active in this checkout. The registry also supports planned entries, but declaring one does not make an app evaluate it. Flag evaluation and SDK behavior are covered in [telemetry](../systems/telemetry.md).

## Integration and modification

`packages/shared/package.json` exports ESM and declarations from compiled output; the server builds shared first, while Vite/Vitest can alias its source. Routes explicitly validate selected inputs; exporting a response schema does not automatically runtime-validate every response (`apps/server/src/routes/sessions.ts`, `apps/server/src/routes/catalog.ts`). Browser query functions validate response bodies using these schemas (`apps/web/src/api/queries.ts`).

Change schemas and consumers together, export additions through `packages/shared/src/index.ts`, and extend tests. Analytics changes must also update `docs/PRIVACY.md`; flag changes must pass the registry checks. Keep media/network/SQLite side effects in the apps. See [API](../api/index.md) for consumers.

## Tested boundaries

Contract tests exercise valid/invalid capabilities, media discriminants, TV episode requirements, subtitle absence versus null, download progress bounds, history filters and statistics shapes (`packages/shared/test/schemas.test.ts`, `packages/shared/test/catalog.test.ts`, `packages/shared/test/playback.test.ts`, `packages/shared/test/downloads.test.ts`, `packages/shared/test/progress.test.ts`).

Privacy tests cover nested denied fields, cycles, adversarial long strings, Sentry IP/geo settings and identity word boundaries. Analytics tests reject unknown events/properties and concrete page paths; flag tests cover defaults, unknown variants and probe shapes (`packages/shared/test/sanitize.test.ts`, `packages/shared/test/identity.test.ts`, `packages/shared/test/analytics.test.ts`, `packages/shared/test/flags.test.ts`). These are pure offline tests, not proof that an SDK or downstream service honors every privacy setting.

## Key source files

| File                                     | Purpose                                           |
| ---------------------------------------- | ------------------------------------------------- |
| `packages/shared/src/index.ts`           | Exports all thirteen implementation modules       |
| `packages/shared/src/schemas.ts`         | Common runtime validation and error envelopes     |
| `packages/shared/src/playback.ts`        | Session/prefetch contract and selection semantics |
| `packages/shared/src/sanitize.ts`        | Browser-safe string, object and Sentry scrubbing  |
| `packages/shared/src/analytics.ts`       | Typed allowlisted product-event catalog           |
| `packages/shared/src/flags.ts`           | Flag definitions, defaults and coercion           |
| `packages/shared/src/identity.ts`        | Host/user word scrubbing without runtime imports  |
| `packages/shared/package.json`           | Compiled export boundary                          |
| `packages/shared/test/sanitize.test.ts`  | Scrubbing regression tests                        |
| `packages/shared/test/analytics.test.ts` | Property allowlist tests                          |
| `packages/shared/test/flags.test.ts`     | Registry/coercion tests                           |

## Measured scope

At the documented commit: **14 tracked source files** in `packages/shared/src/`, **9 tracked test files** in `packages/shared/test/`, **0.64 test-to-code file ratio** (test files divided by source files, including the export barrel). Configs/outputs are excluded. Default-branch history has **1 unique human committer**, VeroxAUS, excluding bots. File counts are not coverage percentages or test-run results.
