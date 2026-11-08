# Viewing progress

Active contributors: VeroxAUS

## Purpose

Viewing progress persists shared resume state and derives Continue Watching/up-next cards. `PlaybackManager.ping` in `apps/server/src/playback/manager.ts` writes progress/history; `ContinueWatchingService` in `apps/server/src/progress/service.ts` builds visible entries from that data.

## Directory layout

| Path                                  | Responsibility                                              |
| ------------------------------------- | ----------------------------------------------------------- |
| `apps/server/src/progress/`           | Pure rules/grouping/traversal and Continue Watching service |
| `apps/server/src/db/progress.ts`      | Latest media-key state and hidden markers                   |
| `apps/server/src/db/plays.ts`         | Per-session watched time/history writes                     |
| `apps/server/src/playback/manager.ts` | Ping orchestration and transactional persistence            |
| `apps/server/src/routes/progress.ts`  | Ping, media/show read and card-removal adapters             |
| `apps/server/test/progress/`          | Offline rule, grouping and next-episode tests               |
| `packages/shared/src/progress.ts`     | Thresholds and progress/history/statistics contracts        |

## Identity and ping semantics

`mediaKeyFor` in `apps/server/src/db/plays.ts` uses movie ID or TV ID/season/episode identity. Resume state is shared by media key, not account/device. Individual play history retains session/device context.

`apps/server/src/routes/progress.ts` validates progress pings and media/show reads. Missing ping state means playing. Pings count as activity while paused or buffering too, preventing paused-but-connected sessions from timing out.

| Rule           | Value/meaning                                        |
| -------------- | ---------------------------------------------------- |
| Saved position | Clamped to nonnegative/probed duration               |
| Complete       | At least **92%** of positive duration                |
| Resumable      | At least **60 seconds**, not complete                |
| Watched time   | Elapsed gap when **previous** ping state was playing |
| Gap cap        | At most **30 seconds** per ping gap                  |

Pure rules live in `apps/server/src/progress/rules.ts`, shared thresholds in `packages/shared/src/progress.ts`. A pause credits preceding playing time; resume does not credit paused time. Seeking to the end can complete a title without crediting the skipped distance as watched time.

The manager transaction writes latest progress and play counters together. `apps/server/src/db/progress.ts` replaces current completion with the newest ping and clears hidden state. `apps/server/src/db/plays.ts` makes play-history completion sticky once reached in that session. These intentionally differ.

Reading resume does not implicitly change a new session start: callers send their chosen start position (`apps/server/src/playback/sessionStart.ts`). The [HLS client](../apps/web/player.md) owns its ping loop and sends a separate desired start position.

## Continue watching and hiding

`selectEntries` in `apps/server/src/progress/entries.ts` groups one entry per movie/show and chooses the newest eligible row. Eligible means resumable, completed or hidden. Hidden rows participate so removing a recent show's card does not resurrect an older episode.

Completed movies disappear. Completed TV episodes can become up-next entries with zero position/duration. `apps/server/src/progress/service.ts` limits visible results to **20**, newest first, with show/episode metadata and next still when available.

Removal hides progress, not history. An up-next entry with no play row gets a hidden marker. A later ping clears hidden state. Bulk show progress includes watched hidden episodes but excludes zero-position hidden markers (`apps/server/src/db/progress.ts`).

```mermaid
graph LR
    Ping[Player ping] --> Rules[Position and time rules]
    Rules --> Save[Transactional write]
    Save --> Progress[(Latest media state)]
    Save --> Plays[(Session history)]
    Progress --> Group[Latest eligible title]
    Group --> Resume[Resume card]
    Group --> Next[Aired next episode]
    Resume --> Home
    Next --> Home
    Plays --> Stats[History and statistics]
```

## Up next

`findNextEpisode` in `apps/server/src/progress/upNext.ts` chooses the next numbered episode of the current season. Otherwise it considers up to **three later seasons whose summaries advertise episodes**, in season order, stopping at the first actual episode found. It does not skip an unaired next episode to offer a later one.

Future air dates are suppressed relative to the server's local calendar day; absent air dates are accepted. Successful lookups including null cache for **one hour**. Failure omits that entry with debug logging instead of failing the whole row (`apps/server/src/progress/service.ts`).

## Browser-local spoiler protection

Continue Watching removal's persisted `hidden` field is **not** the spoiler preference. `isEpisodeHidden` in `apps/web/src/lib/spoilers.ts` uses a browser-local choice (on by default) and the server's completion boolean: unfinished, missing or still-loading progress stays protected. `apps/web/src/components/EpisodeRow.tsx` and `apps/web/src/components/EpisodePanel.tsx` omit protected descriptions and request w92 episode stills instead of w300; they do not alter the saved progress or filter server metadata. Settings stores only the local opt-out, with a page-memory fallback when storage is blocked. See [screens](../apps/web/screens.md) for UI behavior.

## History and local statistics

`apps/server/src/routes/history.ts` exposes paginated history and summary/graph reads. `apps/server/src/db/history.ts` filters per-session plays, separately from resume rows. `apps/server/src/stats/aggregate.ts` builds counts, watched time, bytes and device/output/time buckets; `apps/server/src/stats/timeBound.ts` parses inclusive time bounds.

These are local operational/product records, not telemetry. Dashboard tabs remain placeholders even though server history/statistics APIs and Home/details progress are implemented. See [data models](../reference/data-models.md) and [API](../api/index.md).

## Modification entry points

Change completion/time accounting in `apps/server/src/progress/rules.ts`, title grouping in `apps/server/src/progress/entries.ts`, and next-episode traversal in `apps/server/src/progress/upNext.ts`. Coordinate write changes with the manager and DB queries. Keep position, watched duration, current completion and sticky history completion separate.

`apps/server/test/progress/rules.test.ts`, `apps/server/test/progress/entries.test.ts` and `apps/server/test/progress/upNext.test.ts` cover the pure policies. `apps/server/test/integration/progress-routes.test.ts` covers ping accounting, reopening completed progress, hide/unhide, Home/history and statistics. Browser spoiler tests are outside the measured server-domain scope.

## Key source files

| File                                  | Purpose                      |
| ------------------------------------- | ---------------------------- |
| `apps/server/src/playback/manager.ts` | Ping and transactional write |
| `apps/server/src/progress/rules.ts`   | Pure progress rules          |
| `apps/server/src/progress/entries.ts` | Latest eligible title        |
| `apps/server/src/progress/service.ts` | Cards and hiding             |
| `apps/server/src/progress/upNext.ts`  | Aired episode traversal      |
| `apps/server/src/db/progress.ts`      | Latest resume/hidden state   |
| `apps/server/src/db/plays.ts`         | Per-session history          |
| `apps/server/src/routes/progress.ts`  | Progress API                 |

## Measured scope

At `0a8f04f`: **4 source files / 3 test files**, test/source file ratio **0.75**, **1 unique human contributor**. Method: `git ls-tree -r --name-only 0a8f04fd81cfaa7ca5d1689550ad207e7fc0d3ae`, counting `.ts` under `apps/server/src/progress/` and `*.test.ts` under `apps/server/test/progress/`. Exclude helpers, stats, manager, DB/routes, integration/shared/web tests. Human count uses scoped `origin/main` author history excluding bots, consistent with `.github/CODEOWNERS`. Ratios are not coverage; tests were inspected, not executed.
