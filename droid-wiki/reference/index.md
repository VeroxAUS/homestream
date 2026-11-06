# Reference

This section collects implementation-backed values and storage/contracts rather than prescribing deployment policy. Start with [configuration](configuration.md), [data models](data-models.md), and [dependencies](dependencies.md).

## Locate a fact

| Question | Reference or source |
| --- | --- |
| Which environment value wins? | [Configuration](configuration.md); `apps/server/src/config.ts` |
| Which requests exist? | [API](../api/index.md); `apps/server/src/routes/` |
| What validates a device/session? | `packages/shared/src/schemas.ts`, `packages/shared/src/playback.ts` |
| What survives restart? | [Data models](data-models.md); `apps/server/src/db/` |
| Which packages are direct dependencies? | [Dependencies](dependencies.md); workspace manifests |
| Which output/stat fields are visible? | [Monitoring](../how-to-monitor.md); shared playback schemas |

The public API and internal service methods are different surfaces. In particular, manager progress helpers and source-proxy counters do not imply corresponding HTTP routes. The route implementations remain authoritative.

## Reading the references

Configuration defaults are values actually loaded by the server, not recommendations for every host. Windows data paths and test helpers are concrete implementation assumptions. Node and pnpm versions observed while generating documentation are explicitly distinguished from repository pins.

Schema presence does not prove a complete product feature. For example, the database includes a progress table, while the current home endpoint returns an empty `continueWatching` list; device kinds include desktop and TV despite absent corresponding applications.

Similarly, packages named in workspace/build allowlists are not necessarily present runtimes. Use the [architecture](../overview/architecture.md) and [tooling](../how-to-contribute/tooling.md) pages to distinguish implemented workspaces from placeholders.

No secret values, personal configuration contents, or local database records belong in these references.
