# Experimentation and feature flags

This page is a stub. It will describe how HomeStream uses PostHog feature flags and experiments once product analytics ships. Until then the rules below already apply.

## Rules

- **Flags choose between behaviours that already exist.** A flag never carries data, URLs or secrets.
- **The default is the current behaviour.** When PostHog is not configured (`POSTHOG_API_KEY` empty), when `HOMESTREAM_TELEMETRY=off`, or when the flag service cannot be reached, every flag takes its default and the app behaves exactly as it does today.
- **Flags never block.** They are read asynchronously, cached, and evaluated off the playback path. Starting a title, rendering Home, moving remote focus and serving HLS segments never wait for a flag.
- **Experiments are anonymous.** Assignment uses the random install id described in [PRIVACY.md](PRIVACY.md). Any event an experiment records must be in the typed event catalog listed there.
- **Remove finished flags.** When an experiment ends, delete the flag and the losing branch in the same change.

## Adding a flag

1. Name it in `snake_case` and describe it in this document (name, default, what it changes, owner, planned removal).
2. Read it through the typed flag helper, with the default as a required argument.
3. Test both values, and the case where the flag service is unavailable.
4. Follow the [homestream-telemetry skill](../.factory/skills/homestream-telemetry/SKILL.md) for anything that also sends an event.

## Flags in use

None yet.
