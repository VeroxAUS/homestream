# Reference

These pages collect current configuration, durable models and direct dependencies. Defaults and schemas describe the implementation at `bb48e6d`, not a promise that every planned client or UI exists.

| Question                                     | Page                                                             | Authoritative source                                  |
| -------------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------- |
| Which setting wins, and what is its default? | [Configuration](configuration.md)                                | `apps/server/src/config.ts`, `.env.example`           |
| What survives a restart?                     | [Data models](data-models.md)                                    | `apps/server/src/db/migrations.ts`                    |
| Which JSON shapes cross runtime boundaries?  | [Shared](../packages/shared.md)                                  | `packages/shared/src/index.ts`                        |
| Which packages are directly declared?        | [Dependencies](dependencies.md)                                  | Root and workspace manifests                          |
| Which routes and probes exist?               | [API](../api/index.md), [monitoring](../how-to-monitor/index.md) | `apps/server/src/routes/`                             |
| What can leave the machine?                  | [Telemetry](../systems/telemetry.md)                             | `docs/PRIVACY.md`, `packages/shared/src/analytics.ts` |

Progress/history/downloads/health are implemented server capabilities. Web remains a placeholder and desktop/TV remain planned; schema enums and package allowlists do not prove those apps ship (`apps/web/src/App.tsx`, `README.md`).

Local SQLite data includes device/client identity and upstream cache contents. Do not treat telemetry filtering as encryption or anonymization of local storage, and never copy real configuration or database records into examples. See [security](../security.md).
