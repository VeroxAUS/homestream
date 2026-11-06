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

`packages/shared/src/schemas.ts` bounds device identity/name, dimensions and audio channels. Device kinds describe capabilities, not authentication or shipped apps. Stream IDs are 16 lowercase hexadecimal characters; public stream metadata has no raw upstream URL (`packages/shared/src/streams.ts`).

TV start/prefetch bodies need season and episode. For subtitles, an omitted start selection applies the server default, `null` means Off, and an omitted patch selection means unchanged. A patch must change audio or subtitle selection (`packages/shared/src/playback.ts`). Session-start parsing accepts a bounded string ID, including `auto`; the client product rule is always to send `auto`, not to expose a manual picker.

Catalog and tracking contracts are implemented, not placeholders: Home contains persisted continue watching and featured items, details can include pending downloads, and session creation returns either a session or a distinct downloading envelope. See [catalog](../features/catalog.md), [downloads](../features/downloads.md) and [viewing progress](../features/viewing-progress.md).

## Privacy and analytics

`packages/shared/src/sanitize.ts` has no Node dependency. `sanitizeText` removes URL/token/address patterns and personal home prefixes, with a caller-supplied secret scrubber applied first. `sanitizeValue` deep-copies values, drops denied fields and stops cycles/deep recursion at depth 12. Sentry helpers remove request/user data, trim identifying contexts and make known-root stack paths relative. Scrubbing is a boundary, not authorization.

`packages/shared/src/analytics.ts` defines five product events: `server_started`, `playback_started`, `playback_ended`, `playback_failed` and `prefetch_requested`. `sanitizeEventProperties` drops unknown events/properties and invalid values. Strings must survive scrubbing unchanged, except media titles may retain scrubbed text. This catalog does not itself transmit events or initialize SDKs; those belong to [telemetry](../systems/telemetry.md).

## Feature flags

`packages/shared/src/flags.ts` is intentionally import-free because repository scripts load it directly. Its typed registry, key guard, default lookup and value coercion keep invalid/missing remote values on a local default:

| Flag                       | Status                                         | Default |
| -------------------------- | ---------------------------------------------- | ------- |
| `prefetch-on-details`      | Active server gate for speculative warming     | `true`  |
| `banner-rotation-interval` | Planned client experiment, variants `9s`/`12s` | `9s`    |

Do not describe the planned banner flag as a working UI experiment. Flag evaluation and SDK behavior are covered in [telemetry](../systems/telemetry.md).

## Integration and modification

`packages/shared/package.json` exports ESM and declarations from `dist`; server builds shared first, while Vite/Vitest can alias its source. Routes explicitly validate selected inputs; exporting a response schema does not automatically runtime-validate every response (`apps/server/src/routes/sessions.ts`, `apps/server/src/routes/catalog.ts`).

Change schemas and consumers together, export additions through `packages/shared/src/index.ts`, and extend tests. Analytics changes must also update `docs/PRIVACY.md`; flag changes must pass the registry checks. Keep media/network/SQLite side effects in the apps. See [API](../api/index.md) for consumers.

## Key source files

| File                                     | Purpose                                           |
| ---------------------------------------- | ------------------------------------------------- |
| `packages/shared/src/index.ts`           | Exports all twelve implementation modules         |
| `packages/shared/src/schemas.ts`         | Common runtime validation and error envelopes     |
| `packages/shared/src/playback.ts`        | Session/prefetch contract and selection semantics |
| `packages/shared/src/sanitize.ts`        | Browser-safe string, object and Sentry scrubbing  |
| `packages/shared/src/analytics.ts`       | Typed allowlisted product-event catalog           |
| `packages/shared/src/flags.ts`           | Flag definitions, defaults and coercion           |
| `packages/shared/package.json`           | Compiled export boundary                          |
| `packages/shared/test/sanitize.test.ts`  | Scrubbing regression tests                        |
| `packages/shared/test/analytics.test.ts` | Property allowlist tests                          |
| `packages/shared/test/flags.test.ts`     | Registry/coercion tests                           |

## Measured scope

**13 tracked source files** in `packages/shared/src/`, **8 tracked test files** in `packages/shared/test/`, **0.62 test-to-code file ratio**. Configs/outputs are excluded. Default-branch history has **1 unique human author**, VeroxAUS, excluding bots. File counts are not coverage percentages.
