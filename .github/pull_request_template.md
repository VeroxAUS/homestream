## Summary

<!-- What changes and why, in a few sentences. Link the issue: Fixes #123 -->

## Checks run

- [ ] `pnpm format:check`, `pnpm lint`, `pnpm typecheck`
- [ ] `pnpm knip`, `pnpm dup`, `pnpm deps:check`, `pnpm syncpack:lint`, `pnpm techdebt`
- [ ] `pnpm test:ci` (and `pnpm test:coverage` when the coverage-relevant code changed)
- [ ] `pnpm agents:check`, `pnpm docs:check`, `pnpm openapi:check`, `pnpm db:schema:check`
- [ ] GPU or live tests run where the change needs them (they never run in CI): <!-- which -->

## Telemetry and privacy

- [ ] No new data leaves the machine, or the event is in the typed catalog and in `docs/PRIVACY.md`
- [ ] Logs, events and errors pass through `redact()`
- [ ] Nothing slows Home render, remote focus, playback start or HLS segment serving (numbers attached if a hot path changed)

## Secrets

- [ ] No API key, token, gateway or stream URL, IP address or personal path in code, tests, fixtures, docs or this description
- [ ] `.env.example` lists every new setting (without a value)

## Notes for the reviewer

<!-- Risks, follow-ups, screenshots. -->
