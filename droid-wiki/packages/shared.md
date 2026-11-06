# Shared contracts
Active contributors: VeroxAUS

`@homestream/shared` centralizes Zod runtime schemas and their `z.infer` TypeScript types. It contains no network client, database access, player implementation or encoder.

## Contract families

| Family | Source | Important abstractions |
| --- | --- | --- |
| Export surface | `packages/shared/src/index.ts` | Re-exports all four schema modules |
| Devices and common envelopes | `packages/shared/src/schemas.ts` | CapabilityProfile, Device, ErrorResponse, ServerInfo, event enums |
| Catalog | `packages/shared/src/catalog.ts` | MediaSummary, MovieDetails, ShowDetails, Season, Episode, HomeResponse, search |
| Streams | `packages/shared/src/streams.ts` | StreamOption, StreamsResponse, StreamsQuery and quality enums |
| Playback and warming | `packages/shared/src/playback.ts` | SessionStart/Patch, PrefetchRequest/Response, Decision, tracks, ActivitySession, SessionResponse |

## Validation boundaries

`CapabilityProfile` includes device identity/name/kind, display limits, H.264/HEVC/Main10/HDR10 support and 1–8 audio channels. Display dimensions are positive integers capped at 16384; identity/name strings are trimmed and bounded. The `tv`, `desktop` and `web` enum values are accepted device categories, not evidence of shipped apps.

Catalog shapes distinguish movies from TV and make unavailable images, dates, runtime and IMDb identifiers nullable where defined. Search input is trimmed, nonempty and limited to 200 characters. `ContinueWatchingItem` exists as a shape, but `apps/server/src/routes/catalog.ts` currently returns an empty `continueWatching` array.

Stream IDs are 16 lowercase hexadecimal characters. `StreamOption` exposes parsed metadata and a display label, not a raw upstream URL. `StreamsResponse` supports an optional reason; the current stream service uses `no_streams`, while gateway failures use HTTP error envelopes rather than returning `gateway_error`.

Session and prefetch requests require a positive TMDB ID and a full capability profile; TV additionally requires season and episode. Session starts support an optional position, audio index and nullable subtitle selection. In a session patch, absent subtitle means unchanged, `null` clears it, and at least audio or subtitle must be supplied. Subtitle delivery distinguishes text/bitmap tracks and sidecar/burn selection; these shapes describe the [playback system](../systems/playback/index.md).

## Integration and changes

Routes explicitly call `safeParse` for selected request schemas; exporting a response schema does not imply every response is runtime-validated. Update schema, inferred consumers and tests together. Do not confuse source HDR enum values with the broader stream-discovery HDR labels.

`packages/shared/package.json` exports ESM and declarations from `dist`; `tsconfig.build.json` drives compilation. Server builds shared first; Vite/Vitest can use the shared source alias. Tests are `packages/shared/test/schemas.test.ts`, `packages/shared/test/catalog.test.ts`, and `packages/shared/test/playback.test.ts`.

Measured `packages/shared` scope: **5 production source files**, **3 test files**, **1 unique committer**. Counts use tracked `.ts` files under `src/` and `*.test.ts` under `test/`, excluding configuration/output. Committers are distinct `%cn <%ce>` identities from scoped Git history. See [API](../api/index.md) for routes consuming these shapes.
