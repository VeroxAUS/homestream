# Experimentation and feature flags

HomeStream uses PostHog feature flags to switch between behaviours that already exist and to run small experiments. The flags are declared in one typed registry, `packages/shared/src/flags.ts`, and every flag has a local default, so nothing depends on PostHog being reachable.

## Rules

- **Flags choose between behaviours that already exist.** A flag never carries data, URLs or secrets.
- **The default is the current behaviour.** When PostHog is not configured (`POSTHOG_API_KEY` empty), when `HOMESTREAM_TELEMETRY=off`, or when the flag service cannot be reached, every flag takes its default and the app behaves exactly as it does today.
- **Flags never block.** The server reads them through `telemetry.flag(key)`: PostHog answers are cached for five minutes (a stale answer is served while a new one loads), a failed or slow lookup (2 s limit) falls back to the default and is not retried on every request. Starting a title, rendering Home, moving remote focus and serving HLS segments never wait for a flag.
- **Experiments are anonymous.** Assignment uses the random install id described in [PRIVACY.md](PRIVACY.md). Any event an experiment records must be in the typed event catalog listed there.
- **Remove finished flags.** When an experiment ends, delete the flag, the registry entry and the losing branch in the same change.

## Flags in use

| Flag                       | Type                    | Default | Status  | Owner  | What it changes                                                                                                                                         |
| -------------------------- | ----------------------- | ------- | ------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prefetch-on-details`      | boolean                 | `true`  | active  | server | Whether `POST /api/prefetch` warms up the stream the next Play would pick. Off makes the endpoint answer `streamId: null` without touching the gateway. |
| `banner-rotation-interval` | multivariate `9s`/`12s` | `9s`    | planned | web    | Seconds between slides of the featured banner on Home (web and TV).                                                                                     |

`planned` means the flag is declared and created in PostHog (switched off) but no app reads it yet; `pnpm flags:check` lists it without failing.

### Experiment: banner rotation interval

- **Question:** does a slower banner (12 s) lead to more Play starts from Home than the current 9 s?
- **Variants:** `9s` (control, the current behaviour) and `12s`, 50/50 by install id.
- **Success metric:** `playback_started` events per install per week over two weeks. Guardrail: `playback_failed` must not rise. Recording which variant an install saw needs a new catalog property, so add it to the catalog and to [PRIVACY.md](PRIVACY.md) before the clients ship.
- **Rollout:** create the experiment in PostHog on the `banner-rotation-interval` flag, switch the flag on, ship the client that reads it, and end the experiment by deleting the flag and keeping the winner as the constant.
- The experiment that compared stream-picker layouts was dropped when the manual stream picker was removed (2026-11-05): clients always send `streamId: "auto"`.

## Adding a flag

1. Add it to `FLAGS` in `packages/shared/src/flags.ts` with its type, default, description, owner and `status`.
2. Read it with `await telemetry.flag('your-flag')` (the key and the value type are checked by TypeScript). Never read a flag in a loop or on the segment path.
3. Add it to the table above.
4. Test both values and the case where the flag service is unavailable (see `apps/server/test/telemetry/telemetryOn.test.ts` and `test/integration/telemetryApp.test.ts`).
5. Run `pnpm flags:check` (fails for a flag that is declared active but never read, and for a key the code evaluates but the registry does not declare). It recognises a literal key passed to `flag`, `getFlag`, `isFlagEnabled`, `isFeatureEnabled`, `getFeatureFlag`, `getFeatureFlagPayload`, `useFeatureFlag*`, `flags.isEnabled` and `evaluateFlags` (`flagKeys: [...]`) in `.ts`, `.tsx`, `.kt` and `.mjs` files under `apps` and `packages`; a key held in a variable is not checked.
6. Run `pnpm flags:sync` to create the flag in PostHog.
7. Follow the [homestream-telemetry skill](../.factory/skills/homestream-telemetry/SKILL.md) for anything that also sends an event.

## Commands

| Command            | What it does                                                                                                                                                                                                                                     |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm flags:check` | Fails for dead and unknown flags. Runs without network.                                                                                                                                                                                          |
| `pnpm flags:sync`  | Creates the registry flags that PostHog does not have yet. Never changes an existing flag, so it is safe to repeat. Needs `POSTHOG_PERSONAL_API_KEY`; without it the command prints a message and skips. `--dry-run` shows what it would create. |

Rollout percentages, release conditions and experiments are edited in the PostHog UI after the flag exists.
