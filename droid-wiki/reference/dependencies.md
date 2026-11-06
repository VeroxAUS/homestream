# Dependencies

These counts describe direct declarations in the root and three present workspace manifests, not the transitive lockfile graph. See [tooling](../how-to-contribute/tooling.md) for execution and [architecture](../overview/architecture.md) for runtime boundaries.

## Declaration counts

| Manifest | External runtime | Workspace runtime | Development |
| --- | ---: | ---: | ---: |
| `package.json` | 0 | 0 | 7 |
| `apps/server/package.json` | 6 | 1 | 1 |
| `apps/web/package.json` | 2 | 1 | 4 |
| `packages/shared/package.json` | 1 | 0 | 0 |
| Total declarations | 9 | 2 | 12 |

There are **11 runtime declarations** including workspace edges, **12 development declarations**, and **23 total declarations**. Counting unique names across manifests yields **8 external runtime names**, **12 development names**, and **20 unique external names** overall. The single unique workspace dependency is `@homestream/shared`, declared twice; including it gives **21 unique dependency names**. Zod is the repeated external runtime declaration.

## Runtime packages

| External package | Declared range | Purpose |
| --- | --- | --- |
| `@fastify/cors` | `^11.4.0` | Public CORS policy |
| `@fastify/static` | `^10.1.8` | Optional built web assets |
| `bonjour-service` | `^1.4.4` | mDNS advertisement |
| `fastify` | `^5.12.8` | HTTP server |
| `pino` | `^10.4.0` | Structured logging |
| `zod` | `^4.6.7` | Runtime contract validation; server and shared |
| `react` | `^19.3.1` | Browser scaffold |
| `react-dom` | `^19.3.1` | Browser rendering |

`@homestream/shared` uses `workspace:*` in server and web. SQLite is `node:sqlite`, not an npm dependency. FFmpeg and ffprobe are external executables, also outside these manifest counts.

## Development packages

Root declarations are `@eslint/js` `^10.0.1`, `@types/node` `^26.6.6`, `eslint` `^10.14.0`, `globals` `^17.14.0`, `typescript` `~6.0.3`, `typescript-eslint` `^8.72.1`, and `vitest` `^5.1.0`.

Server adds `tsx` `^4.23.15`. Web adds `@types/react` `^19.3.0`, `@types/react-dom` `^19.3.0`, `@vitejs/plugin-react` `^6.2.1`, and `vite` `^8.3.5`.

Ranges above are manifest intent; `pnpm-lock.yaml` records resolved versions. `pnpm-workspace.yaml` mentions an absent desktop workspace and Electron build permissions, but no desktop manifest contributes to this inventory. Node/pnpm themselves are not pinned in the root manifest.
