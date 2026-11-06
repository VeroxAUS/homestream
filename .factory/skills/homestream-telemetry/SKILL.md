---
name: homestream-telemetry
description: Add or change HomeStream telemetry (Sentry error reports, PostHog product events, feature flags) without leaking data or slowing the app. Use whenever you add an analytics event, a Sentry context or a flag.
---

# Telemetry

Telemetry is Sentry (errors) and PostHog (product analytics and feature flags). It is optional, privacy-first and never allowed to hurt performance. [docs/PRIVACY.md](../../../docs/PRIVACY.md) is the public description of what is sent. The code and that document must always say the same thing.

## Hard rules

1. **Off by default.** Nothing is initialised without its key (`SENTRY_DSN_SERVER`, `SENTRY_DSN_WEB`, `SENTRY_DSN_TV`, `POSTHOG_API_KEY`). `HOMESTREAM_TELEMETRY=off` turns everything off even when keys are set. Both paths need a test.
2. **Never send:** gateway or stream URLs, CDN links, API keys or tokens, IP addresses, file paths, user text (search queries, titles typed by the user), device names, or anything from `.env`.
3. **Typed events only.** Every event is declared in the shared event catalog with its exact property names and types. Properties not in the catalog are dropped by the sanitizer. No autocapture, no session recording, no free-form `capture('anything', {...})`.
4. **Scrub before send.** Errors pass through `redact()` (`apps/server/src/redact.ts`) and the Sentry `beforeSend` filter. PostHog properties pass through the allow-list sanitizer.
5. **Identity** is a random install id. No names, emails or account ids.
6. **Never on the hot path.** Capturing is asynchronous, batched, sampled where needed and wrapped so it can never throw into the caller or delay startup, Home render, remote focus, playback start or HLS segment serving. If the SDK is missing or the network is down, the call does nothing.

## Where things live

- Event catalog: `ANALYTICS_EVENTS` in `packages/shared/src/analytics.ts`. Flag registry: `packages/shared/src/flags.ts`. Sanitizer: `packages/shared/src/sanitize.ts`.
- Server: `apps/server/src/telemetry` (`createTelemetry` returns the `Telemetry` front: `capture`, `captureError`, `breadcrumb`, `flag`, `shutdown`; `app.ctx.telemetry` in routes and services). Playback events come from `telemetry/playbackObserver.ts`.
- Web UI: `apps/web/src/telemetry` (lazy `runtime`, `posthog.ts` with the `before_send` catalog filter, `sentry.ts`, `scrub.ts`), `apps/web/src/logger.ts` and `apps/web/src/api/client.ts` (`apiFetch` adds `X-Request-ID`). Page views: `usePageView(location.pathname)` sends `page_viewed` with a route template. Keys are baked in at build time; see [apps/web/README.md](../../../apps/web/README.md). Desktop main process: `apps/desktop/src/telemetry` (`@sentry/electron` plan in [apps/desktop/README.md](../../../apps/desktop/README.md)).
- Tests run with every telemetry variable removed (`apps/server/test/telemetryEnv.ts`). Use the loopback stub in `apps/server/test/telemetry/stubServer.ts` to look at what would be sent; never call the real services from a test.
- Real check: `pnpm telemetry:smoke --sentry` / `--posthog`. Flags: `pnpm flags:check`, `pnpm flags:sync`. Overview: [docs/observability.md](../../../docs/observability.md).

## Add an event

1. Add the event to the shared catalog (name in `snake_case`, past tense, properties as a zod object of small enums, booleans and bounded numbers; buckets instead of exact values when exact values are identifying, for example a resolution class and not a file name).
2. Call it through the typed wrapper, from the layer that already knows the outcome (service or route), never from inside a loop or per-segment code.
3. Add the event to the catalog table in [docs/PRIVACY.md](../../../docs/PRIVACY.md): name, when it fires, every property and its allowed values.
4. Test it: the event is sanitized (a property with a URL, path or IP is dropped), nothing is sent when the key is missing or `HOMESTREAM_TELEMETRY=off`, and a failing transport does not throw.
5. For a web or desktop event, also extend the end-to-end check in `apps/web/e2e/telemetry.spec.ts` (`pnpm --filter @homestream/web test:e2e` runs the stub build against local receivers).
6. Run the checks from the [homestream-run-checks skill](../homestream-run-checks/SKILL.md).

## Feature flags and experiments

Flags default to the safe, current behaviour when PostHog is unavailable. They are read once (cached) and never block a request. See [docs/experimentation.md](../../../docs/experimentation.md).

## Checklist before you commit

- [ ] No secret or personal value in code, tests, fixtures or docs (use `example.test` hosts and documentation IP ranges).
- [ ] `.env.example` lists any new key (comments only), and [docs/PRIVACY.md](../../../docs/PRIVACY.md) matches the code.
- [ ] Telemetry stays a no-op without keys; measured start-up and playback-start time did not change.
