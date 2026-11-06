# Privacy and telemetry

HomeStream runs on your own PC and serves your own network. It has no accounts and no cloud service of its own. This document says exactly what leaves your machine and how to stop it.

## Summary

- **Off by default.** HomeStream sends nothing to Sentry or PostHog unless you put their keys in `.env` (`SENTRY_DSN_SERVER`, `SENTRY_DSN_WEB`, `SENTRY_DSN_TV`, `POSTHOG_API_KEY`).
- **One switch.** `HOMESTREAM_TELEMETRY=off` disables all of it, whatever keys are set. Restart the server after changing it.
- **Typed events only.** Only the events listed below can be sent, with only the properties listed. There is no autocapture, no session recording and no keystroke, click or screen capture.
- **No identifying data.** Stream URLs, gateway URLs, CDN links, API keys, IP addresses, file paths, device names and anything you type are never sent. Everything passes through a scrubber before it leaves.
- **Anonymous.** Events carry a random install id that is generated locally. It is not derived from your name, hardware or network.

## What the product contacts anyway

Telemetry aside, HomeStream needs these services to work. They receive the requests the feature needs, and nothing else from this project:

| Service                 | Why                      | What it sees                                   |
| ----------------------- | ------------------------ | ---------------------------------------------- |
| TMDB                    | Titles, artwork, ratings | Your TMDB token and the titles you browse      |
| Your AIOStreams gateway | Finding streams          | The title you open, from your server's address |
| Stream CDN              | The video data           | Range requests for the chosen stream           |
| TorBox (optional)       | Caching titles           | Your TorBox key and the title you cache        |

## Error reports (Sentry)

When a DSN is set, unhandled errors in the server, the web UI or desktop shell, and the TV app are reported. A report holds the error type and message, the stack trace, the app version and release, the operating system family and the environment name. Before sending, URLs, tokens, IP addresses and file paths are removed from messages, stack frames and breadcrumbs. No request bodies, cookies or headers are attached.

## Product events (PostHog)

When a key is set, the typed events in the catalog below can be captured. This table is maintained by hand and must list exactly the events of the typed event catalog in `packages/shared`.

### Event catalog

| Event                                                                        | Sent when | Properties |
| ---------------------------------------------------------------------------- | --------- | ---------- |
| _To be filled in with the typed event catalog when product analytics ships._ |           |            |

Allowed property values are small enums, booleans and bounded numbers. Any property that is not in the catalog is dropped before sending.

### Feature flags

Flags are read from PostHog when a key is set. They only choose between behaviours that already exist in the app and default to the current behaviour when PostHog cannot be reached. See [experimentation.md](experimentation.md).

## Where data is stored locally

- `homestream.db` in `DATA_DIR` holds your watch progress, play history, registered devices and the event log. It stays on your PC. Client IP addresses and device names are stored there for the history screen; they are never part of a telemetry event. The tables are described in [database.md](database.md).
- `server.log` in `DATA_DIR` holds the server log, with URLs and keys removed.

Delete these files to erase local history. Nothing in them is uploaded.

## Turning telemetry off

1. Set `HOMESTREAM_TELEMETRY=off` in `.env` (or `%APPDATA%\HomeStream\config.env` for the packaged app), or leave all telemetry keys empty. See [.env.example](../.env.example).
2. Restart the server.

## Questions and reports

If you find something sent that this document does not list, treat it as a bug and report it as described in [SECURITY.md](../SECURITY.md).
