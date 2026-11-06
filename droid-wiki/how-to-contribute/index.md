# Contributing

Contributions should extend the implemented server and shared contracts without assuming the placeholder browser app is a finished client. Start with [getting started](../overview/getting-started.md) and [architecture](../overview/architecture.md).

## Find the right boundary

- HTTP parsing and response wiring: `apps/server/src/routes/`.
- Service construction and resource ownership: `apps/server/src/app.ts`.
- Playback, encoders, and subtitle lifetimes: `apps/server/src/playback/`.
- Upstream byte caching: `apps/server/src/sourceproxy/`.
- Catalog and discovery: `apps/server/src/tmdb/`, `apps/server/src/gateway/`, and `apps/server/src/streams/`.
- Shared runtime validation and TypeScript contracts: `packages/shared/src/`.
- Browser scaffold: `apps/web/src/`.

Read the neighboring tests before changing a subsystem. A new timer, process, socket, or file requires a clear owner and cleanup path. The app factory exposes injected services and timing seams specifically to make this testable.

## Before handing off

Follow [development workflow](development-workflow.md), [patterns and conventions](patterns-and-conventions.md), and [testing](testing.md). Report the exact commands executed, their outcomes, and environment-dependent checks left unrun. Do not describe a limited unit run as a complete playback validation.

Keep credentials, signed source URLs, local database contents, device identities, and personal configuration out of patches and examples. See [security](../security.md).

The checkout has no contributor guide, CODEOWNERS, or CI workflow establishing mandatory review, branch naming, or merge rules. Do not infer those policies from this wiki. Human history currently identifies VeroxAUS alone, so there is no separate maintainers page or invented ownership roster.
