# Reference

These pages collect configuration, durable models and dependency inventories for **`0a8f04fd81cfaa7ca5d1689550ad207e7fc0d3ae`**, inspected **2026-11-08**. They describe the implemented server, web player and Electron shell; maintained operator documents remain under `docs/` and `docs/runbooks/`.

| Question                         | Page                                      | Source of truth                                       |
| -------------------------------- | ----------------------------------------- | ----------------------------------------------------- |
| Which setting wins?              | [Configuration](configuration.md)         | `apps/server/src/config.ts`, `.env.example`           |
| What survives restart?           | [Data models](data-models.md)             | `apps/server/src/db/migrations.ts`                    |
| Which JSON crosses boundaries?   | [Shared contracts](../packages/shared.md) | `packages/shared/src/index.ts`                        |
| Which dependencies are declared? | [Dependencies](dependencies.md)           | Root and workspace package manifests                  |
| Which routes exist?              | [API](../api/index.md)                    | `apps/server/src/routes`, `docs/openapi.json`         |
| What can leave the machine?      | [Telemetry](../systems/telemetry.md)      | `docs/PRIVACY.md`, `packages/shared/src/analytics.ts` |

## Maintained documentation

| Reference                                                                                                            | Use                                                                             |
| -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| [Architecture](../../docs/architecture.md)                                                                           | Product rules, component boundaries and diagrams                                |
| [Generated OpenAPI](../../docs/openapi.json)                                                                         | Documented methods, request/response fields and statuses                        |
| [Database guide](../../docs/database.md) and [generated schema](../../docs/schema.sql)                               | Migration/table descriptions and complete DDL                                   |
| [Observability](../../docs/observability.md)                                                                         | Logs, correlation, probes, metrics and telemetry setup                          |
| [Alerting](../../docs/alerting.md)                                                                                   | Checked-in thresholds, Sentry workflow tooling and response mapping             |
| [Privacy](../../docs/PRIVACY.md)                                                                                     | Outbound event catalog, opt-outs and required account controls                  |
| [Experimentation](../../docs/experimentation.md)                                                                     | Flag registry, defaults and safe rollout                                        |
| [Runbooks](../../docs/runbooks/README.md)                                                                            | Gateway, TorBox, encoder, disk, orphan, rollback, profiling and test procedures |
| [Contribution rules](../../CONTRIBUTING.md), [agent rules](../../AGENTS.md) and [security policy](../../SECURITY.md) | Change gates and private vulnerability reporting                                |

`apps/server/src/docs/generated.ts` generates OpenAPI/schema files; `pnpm openapi:check` and `pnpm db:schema:check` detect generation drift. Schemas and prose still need source review: for example, gateway cache objects contain playback URLs despite the broader no-URL statement in `docs/database.md`, and subtitle pending responses include a runtime 503 not enumerated by their route-doc entry. See [security](../security.md) and [API](../api/index.md) for those limits.

## Implemented and deferred surfaces

Settings/About and browser-local spoiler controls are implemented; [Settings and spoilers](../apps/web/settings-and-spoilers.md) explains their ownership. This does not add an HTTP settings route or a spoiler column to SQLite (`apps/web/src/pages/SettingsPage.tsx`, `apps/web/src/lib/spoilers.ts`, `apps/server/src/db/migrations.ts`).

Dashboard tabs remain placeholders and TV has no workspace (`apps/web/src/pages/dashboard/DashboardPlaceholder.tsx`, `pnpm-workspace.yaml`). `docs/ideas.md` and `docs/ideas/` are proposals, not shipped behavior. The implemented [web](../apps/web/index.md) and [desktop](../apps/desktop/index.md) pages distinguish those limits from working playback and shell behavior.

Local SQLite contains watch history, device data, and upstream cache contents. Telemetry filtering is not local encryption or anonymization. Never copy real settings or database rows into examples; see [security](../security.md).
