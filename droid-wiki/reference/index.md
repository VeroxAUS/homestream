# Reference

These pages collect configuration, durable models and direct dependencies at commit `7eb94bafed5e0e046987a81d0cbbff8e6ba999d1`. They describe the implemented server, browser application and desktop support modules, not every planned client feature.

| Question                                     | Page                                                             | Authoritative source                                                                                                             |
| -------------------------------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Which setting wins, and what is its default? | [Configuration](configuration.md)                                | `apps/server/src/config.ts`, `.env.example`                                                                                      |
| What survives a restart?                     | [Data models](data-models.md)                                    | `apps/server/src/db/migrations.ts`                                                                                               |
| Which JSON shapes cross runtime boundaries?  | [Shared](../packages/shared.md)                                  | `packages/shared/src/index.ts`                                                                                                   |
| Which packages are directly declared?        | [Dependencies](dependencies.md)                                  | `package.json`, `apps/server/package.json`, `apps/web/package.json`, `apps/desktop/package.json`, `packages/shared/package.json` |
| Which routes and probes exist?               | [API](../api/index.md), [monitoring](../how-to-monitor/index.md) | `apps/server/src/routes/`                                                                                                        |
| What can leave the machine?                  | [Telemetry](../systems/telemetry.md)                             | `docs/PRIVACY.md`, `packages/shared/src/analytics.ts`                                                                            |

Progress/history/downloads/health are implemented server capabilities. The [web app](../apps/web/index.md) implements Home, search, details and Settings, but its player and dashboard tabs remain placeholders (`apps/web/src/App.tsx`, `apps/web/src/pages/PlayerPage.tsx`). The [desktop package](../apps/desktop.md) has telemetry/logging/request support, not a window, tray, preload or supervisor (`apps/desktop/src/index.ts`, `apps/desktop/README.md`). TV remains planned (`README.md`); schema enums and build allowlists are not evidence of a working app.

Local SQLite data includes device/client identity and upstream cache contents. Do not treat telemetry filtering as encryption or anonymization of local storage, and never copy real configuration or database records into examples. See [security](../security.md).
