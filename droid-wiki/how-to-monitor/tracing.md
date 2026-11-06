# Tracing

HomeStream currently provides request-ID correlation and manually reported Sentry errors/breadcrumbs, not a complete distributed tracing pipeline. A configured sampler is not evidence that requests produce traces (`apps/server/src/requestContext.ts`, `apps/server/src/telemetry/sentry.ts`).

## Follow a request

1. Read the response's `X-Request-ID`, or supply a safe ID on the request.
2. Find `reqId` in local process logs to join the completion line with service/error logs in the same async chain.
3. For an unexpected HTTP error, search optional Sentry reports by `request_id`.
4. Inspect domain logs and the session/activity snapshot separately for playback lifecycle state.

`apps/server/src/requestContext.ts` validates IDs and uses AsyncLocalStorage. `apps/server/src/logger.ts` adds the current ID to the base logger without duplicating a bound child ID. `apps/server/src/http/observability.ts` returns the header on responses; `apps/server/src/app.ts` exposes it through CORS and supplies it to unexpected-error reporting.

Request IDs do not automatically become session event IDs. Background work may have no current request scope, and FFmpeg/CDN/service requests are not a distributed request trace. See [logging](logging.md).

The browser's `apiFetch` generates the request ID and includes it in API breadcrumbs and `ApiError.requestId` for non-2xx responses (`apps/web/src/api/client.ts`). Use that ID or the response header to correlate the server failure. Desktop's `withRequestId` is a tested helper, not proof that a working shell is already making requests (`apps/desktop/src/requestId.ts`).

## Sentry configuration and limits

`apps/server/src/telemetry/sentry.ts` sets a **0.05** trace sample rate and a path-aware sampler. Sampling is **0** for `/hls/*`, `/metrics`, `/healthz`, `/readyz` and `/api/events`; query strings are stripped when identifying those paths.

However, the SDK integration allowlist excludes HTTP, Fastify and database auto-instrumentation, and no server source call site currently creates spans with `startSpan`. There is no automatic request transaction tree, cross-service propagation, OpenTelemetry exporter, span-name catalog or guaranteed browser-to-server continuation. CORS permits `sentry-trace` and `baggage` headers for compatibility; permitting headers alone does not consume them into a trace.

The implemented manual breadcrumbs describe playback start/end/failure/restart under category `playback` (`apps/server/src/telemetry/playbackObserver.ts`). Reports use release `homestream@<version>`, environment and optional request/device/media tags. SDK error integrations also handle uncaught exceptions/unhandled rejections. Error capture and all payload hooks are explained under [telemetry](../systems/telemetry.md).

Browser Sentry and the desktop option builder set trace sampling to **zero** (`apps/web/src/telemetry/sentry.ts`, `apps/desktop/src/telemetry/sentry.ts`). A Sentry issue, a release deploy marker or a permitted trace header does not imply that end-to-end spans exist.

## Instrumentation changes

Start at `apps/server/src/telemetry/sentry.ts` if introducing real spans, and explicitly decide safe names, sampling and lifecycle ownership. Route templates and fixed operation names are appropriate; media titles, IDs, paths and source URLs are not. Keep HLS, probes and SSE outside per-request tracing, run transaction payloads through `packages/shared/src/sanitize.ts`, and add a stub-collector payload test.

Do not enable broad default integrations merely to make traces appear. That would change both privacy and playback-path work. Update `docs/PRIVACY.md` and `docs/observability.md` when actual outbound behavior changes.

## Key source files

| File                                                 | Purpose                                        |
| ---------------------------------------------------- | ---------------------------------------------- |
| `apps/server/src/requestContext.ts`                  | Correlation ID validation and async scope      |
| `apps/server/src/http/observability.ts`              | Response header and accepted trace headers     |
| `apps/server/src/app.ts`                             | CORS exposure and unexpected HTTP errors       |
| `apps/server/src/telemetry/sentry.ts`                | Sampler, restricted integrations and reporting |
| `apps/server/src/telemetry/playbackObserver.ts`      | Manual playback breadcrumbs                    |
| `packages/shared/src/sanitize.ts`                    | Error and transaction payload filtering        |
| `apps/server/test/telemetry/telemetryUnits.test.ts`  | Sampling and request-context tests             |
| `apps/server/test/integration/observability.test.ts` | HTTP request-ID/CORS integration               |
