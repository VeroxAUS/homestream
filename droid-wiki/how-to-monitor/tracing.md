# Tracing

HomeStream implements request-ID correlation and restricted Sentry error/breadcrumb reporting, not a complete distributed tracing pipeline. Configuring a sampler or allowing trace headers does not create spans. See [logging](logging.md).

## Follow a failure

1. Read response `X-Request-ID`, or supply a valid short ID.
2. Search `reqId` in `DATA_DIR/server.log` to join request completion with service/error logs in that async chain.
3. If an unexpected HTTP failure was reported to enabled Sentry, search its `request_id` tag.
4. Inspect domain events and session/activity snapshots separately for playback state.

`resolveRequestId` in `apps/server/src/requestContext.ts` accepts 1–64 letters, digits, dots, underscores or hyphens and otherwise generates a UUID. AsyncLocalStorage carries it through the request's asynchronous work. `createLogger` in `apps/server/src/logger.ts` adds the ID unless the child logger already binds it.

`registerRequestObservability` in `apps/server/src/http/observability.ts` sets the response header. `apps/server/src/app.ts` exposes it through CORS and attaches unexpected-error context. Background work may have no request ID; a playback session ID and request ID are not interchangeable.

Browser `apiFetch` in `apps/web/src/api/client.ts` adds request IDs and includes them in breadcrumbs/`ApiError.requestId`. Desktop `createServerClient` in `apps/desktop/src/serverHttp.ts` uses `withRequestId` from `apps/desktop/src/requestId.ts` for main-process server requests. This is working shell wiring, not an unused request helper. See [desktop supervision](../apps/desktop/supervisor.md).

## What Sentry actually does

`initSentry` and `tracesSampler` in `apps/server/src/telemetry/sentry.ts` configure a **5%** sample rate for eligible tracing contexts, with **zero** for HLS, metrics, liveness/readiness and SSE. The path matcher strips queries.

However, retained integrations are error-oriented: HTTP, Fastify and database automatic instrumentation are excluded. There are no current server `startSpan` call sites, automatic request transaction trees, OpenTelemetry exporter or guaranteed browser-to-server trace continuation. CORS permits `sentry-trace` and `baggage`; permitting them does not consume them into spans.

`apps/server/src/telemetry/playbackObserver.ts` explicitly adds playback lifecycle breadcrumbs and reports failures. Reports use release/environment and optional request/device/media context. Uncaught exception/rejection integrations remain available. Browser Sentry and Electron main both use trace sampling **zero** (`apps/web/src/telemetry/sentry.ts`, `apps/desktop/src/telemetry/sentry.ts`).

A Sentry issue, browser breadcrumb, release deploy marker or permitted header is not evidence of an end-to-end trace. See [telemetry](../systems/telemetry.md) for enablement, inference controls and payload sanitization.

## Adding real instrumentation

Start with an explicit instrumentation plan rather than enabling all default integrations. Choose safe route-template/fixed-operation names, bounded sampling and clear span lifetime/ownership. Do not put titles, session/device/media IDs, file paths or source URLs in span names/attributes.

Preserve media/probe/SSE exclusions and scrub transactions through `sanitizeSentryEvent` in `packages/shared/src/sanitize.ts`. Add stub-collector payload tests and update `docs/PRIVACY.md`/`docs/observability.md` when actual outbound behavior changes. Measure playback/Home overhead before and after hot-path changes.

This page is based on source inspection, not a live trace capture or benchmark.

## Key source files

| File | Purpose |
| --- | --- |
| `apps/server/src/requestContext.ts` | ID validation and async scope |
| `apps/server/src/http/observability.ts` | Correlation header and completion instrumentation |
| `apps/server/src/telemetry/sentry.ts` | Restricted integrations and sampling |
| `apps/server/src/telemetry/playbackObserver.ts` | Manual lifecycle breadcrumbs/reports |
| `apps/web/src/api/client.ts` | Renderer request correlation |
| `apps/desktop/src/serverHttp.ts` | Main-process client correlation |
| `packages/shared/src/sanitize.ts` | Error/transaction filtering |
| `apps/server/test/telemetry/telemetryUnits.test.ts` | Sampling/context cases |
| `apps/server/test/integration/observability.test.ts` | HTTP/CORS/request-ID integration |
