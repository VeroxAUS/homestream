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

When a DSN is set, unhandled errors in the server, the web UI or desktop shell, and the TV app are reported. A report holds the error type and message, the stack trace, the app version and release, the operating system family and the environment name. Before sending, URLs, tokens, IP addresses and file paths are removed from messages, stack frames and breadcrumbs: registered secrets and authorization fields are replaced, gateway and CDN URLs and query strings are cut, private network addresses are masked and Windows user folders become `<home>`. No request bodies, cookies, headers, user, IP address or server name are attached. Server reports carry the release (`homestream@<version>`), the environment and the tags `request_id`, `device.kind` and `media.type` when known. At most 5 % of requests are sampled for performance traces, and never `/hls/*`, `/metrics`, `/healthz`, `/readyz` or `/api/events`.

### Web UI and desktop shell

The web UI (in a browser or inside the desktop shell) and the desktop shell's main process report to the Sentry project `homestream-web`; the TV app has its own project. The keys are not read at run time: they are baked into the web UI when it is built (`SENTRY_DSN_WEB`, `POSTHOG_API_KEY`, `POSTHOG_HOST`), and a build made without them contains no key and sends nothing. Web reports carry the release (`homestream@<version>`), the environment and the tags `app` (`web`), `process` (`renderer` in the UI, `main` in the desktop shell's main process), `device.kind` (`web` or `desktop`) and `route` (a route template such as `/movie/:id`). Script locations in stack traces are reduced to a path (`app:///assets/index-1.js`) without the address of your server, and request URLs are reduced to a path without query string. The web UI sends one product event, `page_viewed`, with a route template; it does not use autocapture, session recording or surveys. It reads one feature flag (`banner-rotation-interval`) from PostHog, which sends the random install id and nothing else about the page, and defaults to 9 seconds when PostHog cannot be reached.

## Product events (PostHog)

When a key is set, the typed events in the catalog below can be captured. This table is maintained by hand and must list exactly the events of the typed event catalog in `packages/shared`.

### Event catalog

| Event                | Sent when                                                          | Properties                                                                                                                         |
| -------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `server_started`     | The server finished starting.                                      | `version`, `os`, `packaged`, `nodeMajor`                                                                                           |
| `playback_started`   | A playback session produced its first segment.                     | `mediaType`, `tmdbId`, `title`, `season`?, `episode`?, `deviceKind`, `videoCodec`, `hdr`, `toneMapped`?, `resolution`, `startupMs` |
| `playback_ended`     | A playback session ended.                                          | `mediaType`, `tmdbId`, `title`, `deviceKind`, `reason`, `watchedSec`, `avgSpeed`?                                                  |
| `playback_failed`    | A playback session could not start, or its encoder failed playing. | `mediaType`, `tmdbId`, `title`?, `deviceKind`, `stage`, `errorCode`                                                                |
| `page_viewed`        | The web UI (browser or desktop window) showed a page.              | `route` (a route template such as `/movie/:id`, never the real path), `deviceKind`                                                 |
| `desktop_started`    | The desktop shell finished starting.                               | `version`, `os`, `packaged`, `hidden`                                                                                              |
| `prefetch_requested` | A client asked the server to warm up the stream for a title.       | `mediaType`, `tmdbId`, `deviceKind`, `flagEnabled`                                                                                 |

A trailing `?` marks a property that is only sent when it applies. Every event also carries `app` (`server`, `web` or `desktop`), `appVersion` and the random install id as its identity, with person profiles and GeoIP lookups switched off.

Allowed property values are small enums, booleans and bounded numbers. The only free text is the media **title** (a movie or show name from TMDB, never something you typed). A title that contains a URL, key, address or path is scrubbed like any other text. Any property that is not in the catalog is dropped before sending, and so is any value that does not match its declared type.

The catalog is `ANALYTICS_EVENTS` in `packages/shared/src/analytics.ts`; a test fails when this table and the catalog disagree.

### Install id

The server creates a random UUID the first time telemetry starts and keeps it in the `settings` table of `homestream.db` (key `install_id`). It is the only identity an event has. It is not derived from your host name, user name, hardware or network, and deleting the database creates a new one.

### Feature flags

Flags are read from PostHog when a key is set; the server sends only its install id to ask for them. They only choose between behaviours that already exist in the app and default to the current behaviour when PostHog cannot be reached. See [experimentation.md](experimentation.md).

## Required account settings

The apps never send an IP address, but both services add the sender's connection address themselves when an event arrives. The code tells them not to (Sentry: every event carries `sdk.settings.infer_ip: "never"` and an empty `user.geo`, which makes ingestion skip its location lookup and leaves no location in the stored event; PostHog: `$geoip_disable` is set), and two account settings must be on so nothing is stored even if that fails. Turn them on once; nothing in the repository can check them for you.

| Service | Where                                                                                                                                                                                 | Setting                                |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| Sentry  | Organization Settings > Security & Privacy, and Project Settings > Security & Privacy for each of `homestream-server`, `homestream-web` and `homestream-tv` (API: `scrubIPAddresses`) | **Prevent Storing of IP Addresses** on |
| PostHog | Settings > Project > IP data capture configuration (API: project field `anonymize_ips`)                                                                                               | **Discard client IP data** on          |

PostHog adds `$ip` from the request that delivered the event, whatever the client sends, so this project setting is the only control over it. Check that it holds by reading the stored events of a smoke run (`pnpm telemetry:smoke`, see [observability.md](observability.md)): a Sentry event has no `user.ip_address` and no `user.geo`, a PostHog event has no `$ip`.

## Where data is stored locally

- `homestream.db` in `DATA_DIR` holds your watch progress, play history, registered devices and the event log. It stays on your PC. Client IP addresses and device names are stored there for the history screen; they are never part of a telemetry event. The tables are described in [database.md](database.md).
- `server.log` in `DATA_DIR` holds the server log, with URLs and keys removed.

Delete these files to erase local history. Nothing in them is uploaded.

## Turning telemetry off

1. Set `HOMESTREAM_TELEMETRY=off` in `.env` (or `%APPDATA%\HomeStream\config.env` for the packaged app), or leave all telemetry keys empty. See [.env.example](../.env.example).
2. Restart the server.

The web UI decides at build time: build it with `HOMESTREAM_TELEMETRY=off` or without keys. A single browser can also opt out of a build that has keys: run `localStorage.setItem('homestream.telemetry', 'off')` in its developer console and reload.

## Questions and reports

If you find something sent that this document does not list, treat it as a bug and report it as described in [SECURITY.md](../SECURITY.md).
