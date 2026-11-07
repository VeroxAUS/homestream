# Reference

These pages collect configuration, durable models, and direct dependencies for source commit `5eefa37775db95b4bdd1e1dfe7b33cb8a9f31001`. They describe the current server, web player, and Electron shell rather than planned clients.

| Question | Page | Source of truth |
| --- | --- | --- |
| Which setting wins? | [Configuration](configuration.md) | `apps/server/src/config.ts`, `.env.example` |
| What survives restart? | [Data models](data-models.md) | `apps/server/src/db/migrations.ts` |
| Which JSON crosses boundaries? | [Shared contracts](../packages/shared.md) | `packages/shared/src/index.ts` |
| Which dependencies are declared? | [Dependencies](dependencies.md) | Root and workspace package manifests |
| Which routes exist? | [API](../api/index.md) | `apps/server/src/routes`, `docs/openapi.json` |
| What can leave the machine? | [Telemetry](../systems/telemetry.md) | `docs/PRIVACY.md`, `packages/shared/src/analytics.ts` |

Dashboard tabs remain placeholders and TV has no workspace (`apps/web/src/pages/dashboard/DashboardPlaceholder.tsx`, `pnpm-workspace.yaml`). The implemented [web](../apps/web/index.md) and [desktop](../apps/desktop/index.md) pages distinguish those limits from working playback and shell behavior.

Local SQLite contains watch history, device data, and upstream cache contents. Telemetry filtering is not local encryption or anonymization. Never copy real settings or database rows into examples; see [security](../security.md).
