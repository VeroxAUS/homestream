# Network controls

Active contributors: VeroxAUS

Network controls bound remote media reads and advertise useful LAN addresses. `DownloadGate` in `apps/server/src/network/downloadGate.ts` schedules aggregate bytes; `ReadAheadWindow` in `apps/server/src/network/readAhead.ts` controls time hysteresis; `getLanAddresses` in `apps/server/src/net.ts` supplies server-info and discovery addresses.

## Purpose

Keep competing playback/subtitle/prefetch work within the configured household budget without treating intentional waiting as a fault. LAN-address selection is a reachability heuristic, not authentication or a firewall. See [source proxy](source-proxy.md) and [security](../security.md).

## Download defaults and scope

| Setting               | Default and validation                                |
| --------------------- | ----------------------------------------------------- |
| MAX_DOWNLOAD_MBPS     | **150 decimal Mbps**, accepted minimum 5              |
| READ_AHEAD_SEC        | **180 seconds**, positive                             |
| READ_AHEAD_RESUME_SEC | **120 seconds**, positive and below configured window |

`resolveDownloadLimits` in `apps/server/src/network/limits.ts` warns/falls back rather than refusing startup. Invalid window/resume settings reset that pair together. Zero does not disable limits. One Mbps means 1,000,000 bits/second.

The [proxy](source-proxy.md) creates one shared gate for head/tail warming and remote demand reads. It does not cap TMDB/gateway metadata, outbound HLS, all machine traffic or TorBox's remote caching. Cached/local-file reads spend no remote-byte tokens.

## Scheduling and extractor share

`TokenBucket` in `apps/server/src/network/tokenBucket.ts` uses a **0.2-second bucket depth**. Whole chunks may overdraw tokens; the next grant waits for repayment. Readers ask after receiving a chunk and before passing it onward, so these are application-read limits, not control over every byte already in kernel/socket buffers.

Ordinary priority is encoder, prefetch, extractor, then lower lead and arrival order. Waiting requests age after **1500 ms**, but aging never overrides an at-risk encoder below **15 seconds** lead. The guard remembers risk for **200 ms**. While it applies, encoders above 60 seconds wait; intermediate-lead encoders need surplus beyond a 0.05-second reserve.

Extractors share a **20% priority rate** while no encoder is at risk. This is shared among extractor readers, not granted per worker, and is not a reserved slice: unused tokens go elsewhere. The main bucket always governs total grants.

`atLeastExtractorShare` in `apps/server/src/network/downloadGate.ts` raises finite local extractor pacing to that share; null remains unlimited. At 150 Mbps this floor is **3,750,000 bytes/s**, above a proposed 2 MiB/s throttle. Local pacing never bypasses the aggregate gate.

```mermaid
graph LR
    Encoder[Encoder bytes] --> Gate[Shared token gate]
    Warm[Prefetch and warm bytes] --> Gate
    Extractor[Extractor bytes] --> Gate
    Risk[Low-lead guard] --> Gate
    Share[Shared extractor priority rate] --> Gate
    Gate --> Meter[Granted-byte meter]
    Meter --> Reader[Loopback reader]
```

## Read-ahead and feedback

`leadSeconds` in `apps/server/src/network/readAhead.ts` uses the end of the last finished segment minus playhead. `ReadAheadPacing` in `apps/server/src/playback/readAheadPacing.ts` clamps that playhead to at least the current encoder run's start. A window closes on **anticipated lead**, but resumes on **actual lead strictly below** the resume point. Start/seek/restart resets filling.

`encoderWindowSec` in `apps/server/src/network/readAhead.ts` subtracts a **four-second pipeline allowance**, with a minimum threshold of one second. At the defaults, **176 seconds is the anticipated closing threshold, not a fixed actual lead at which reads stop**. `holdLeadSec` computes:

```text
sourceBytesPerSec = source.sizeBytes / probe.durationSec
pipelineAllowanceSec = max(4, 8 MiB / sourceBytesPerSec)
closeLeadSec = actualLeadSec + max(0, recentSpeed) * 1.5 + (pipelineAllowanceSec - 4)
```

The source rate is a whole-file average, not a measured instantaneous bitrate; unknown/nonpositive source rate falls back to the four-second allowance. The **8 MiB** models buffered input and **1.5 seconds** allows for progress-report latency. Recent speed uses output-time deltas over a roughly four-second sample window, requires at least **1.5 seconds** of samples and is zero while unknown; it is not FFmpeg's whole-run average. A new encoder run clears those samples. Reopening still uses actual lead below **120 seconds**, even if anticipated lead remains above the closing threshold.

`apps/server/test/network/readAhead.test.ts` models once-per-second reports, several report offsets, 8 MiB in flight and roughly 7/25/35 Mbps sources at 8.4×/2.4×/1.7× encoding speed. Its **184-second finished-lead assertion is offline model evidence, not a real-world hard ceiling**. `apps/server/test/playback/readAheadPacing.test.ts` checks that actual and predicted values reach the source handle, including low-bitrate and unknown-speed cases.

`ReaderHolds` in `apps/server/src/sourceproxy/readerHolds.ts` keeps viewers independent even when their bytes are shared. [Subtitle time windows](playback/subtitles.md) still use each run's read head relative to player reach, including the latest video segment request, without this encoder prediction. Encoder window transitions produce URL-free memory/cache notes through `apps/server/src/sourceproxy/readAheadNotes.ts`; see [logging](../how-to-monitor/logging.md) for fields, scope and throttling.

A separate byte-gap bound keeps extractor data near its own encoder: hold strictly beyond **min(effective per-source cache budget / 2, 16 MiB)**, release at/below half that distance (**16/8 MiB** by default). This both limits cache eviction of unread encoder bytes and prevents a large extractor cache lead from masking renewed upstream demand after reopening. In the file's middle, held remote stretches end at block boundaries and wait; cached bytes also obey holds. Header and tail-index reads bypass the pump's time/byte-gap hold wait so a held demuxer can open its input (`apps/server/src/sourceproxy/serve.ts`). The exact edge condition is `pos < headTarget` or `pos >= Math.max(headTarget, size - TAIL_BYTES)`, where headTarget is at most **16 MiB** and TAIL_BYTES is **8 MiB** (`apps/server/src/sourceproxy/sourceEntry.ts`). This exemption is checked per pump iteration; it does not disable remote-byte accounting, aggregate limits, finite extractor pacing or discard cuts. See [source proxy](source-proxy.md) for range boundaries and test limits. These controls differ from [disk parking](playback/lifecycle.md).

## LAN addresses and mDNS

`getLanAddresses` in `apps/server/src/net.ts` collects non-internal IPv4 addresses, excluding `127.*` even if an adapter marks it non-internal. It then prefers candidates that are neither `169.254.*` nor on names matching **vEthernet, WSL, Hyper-V, Docker, VirtualBox or VMware**, case-insensitively.

**Filtering applies only when at least one such physical candidate remains.** Otherwise every non-internal/non-loopback IPv4 candidate is returned, including virtual/link-local addresses. IPv6 is never included; an offline/loopback-only machine yields an empty list.

Addresses are deduplicated and ranked: `192.168.*`, `10.*`, `172.16/12`, other IPv4, link-local last. “Physical” is an adapter-name heuristic, not a verified network route.

`registerInfoRoutes` in `apps/server/src/routes/info.ts` reports this list in `/api/info` and the actual listening port when available. `startDiscovery` and `withAddresses` in `apps/server/src/discovery.ts` use the same list for `_homestream._tcp`: replace all library-generated A/AAAA records with exactly these IPv4 A records while retaining service records. This prevents WSL/Hyper-V addresses from being advertised alongside usable LAN candidates. Goodbye packets use the same record override.

Discovery is best effort, can be disabled with `HOMESTREAM_MDNS=off`, and does not change listener binding. `stripIpv6Prefix` in `apps/server/src/net.ts` separately unwraps IPv4-mapped request addresses; it is not the adapter filter.

## Measurements and modification

`RateMeter` in `apps/server/src/network/rateMeter.ts` uses 250 ms slots; `networkSnapshot` in `apps/server/src/network/snapshot.ts` joins proxy aggregate and session readings. The default reporting window is five seconds. Per-session rates may refer to the same shared source, so do not sum them as separate downloads.

`buildNetworkCheck` in `apps/server/src/network/check.ts` warns after the cap has continuously bound for more than **30 seconds**; it does not turn normal limiting into an error. [Health](health.md) separately interprets falling-behind encoding.

Change fairness in `apps/server/src/network/downloadGate.ts`, prediction/window rules in `apps/server/src/network/readAhead.ts`, feedback and recent-speed sampling in `apps/server/src/playback/readAheadPacing.ts`, settings in `apps/server/src/network/limits.ts`, and address heuristics in `apps/server/src/net.ts` plus discovery regression tests. Keep modeled lead tests separate from live measurements. See [playback](playback/index.md) and [configuration](../reference/configuration.md).

## Key source files

| File                                                   | Purpose                                             |
| ------------------------------------------------------ | --------------------------------------------------- |
| `apps/server/src/network/downloadGate.ts`              | Cap, risk guard and shared extractor rate           |
| `apps/server/src/network/tokenBucket.ts`               | Whole-chunk token accounting                        |
| `apps/server/src/network/limits.ts`                    | Validation and unit conversion                      |
| `apps/server/src/network/readAhead.ts`                 | Actual/predicted hysteresis and pipeline allowance  |
| `apps/server/src/playback/readAheadPacing.ts`          | Source-rate estimate and recent-speed feedback      |
| `apps/server/src/sourceproxy/leadBound.ts`             | Owner-specific capped extractor byte lead           |
| `apps/server/test/network/readAhead.test.ts`           | Prediction, hysteresis and modeled finished lead    |
| `apps/server/test/playback/readAheadPacing.test.ts`    | Actual/predicted source-handle feedback             |
| `apps/server/test/sourceproxy/resumeAfterHold.test.ts` | Bounded cached lead before upstream reads resume    |
| `apps/server/src/sourceproxy/serve.ts`                 | Holds with header/tail pump exemption               |
| `apps/server/test/sourceproxy/sessionSharing.test.ts`  | Tail-index exemption and middle-file byte lead      |
| `apps/server/src/net.ts`                               | Filter/rank addresses and normalize request IP      |
| `apps/server/src/discovery.ts`                         | Filtered mDNS record publication                    |
| `apps/server/test/network/bandwidthPriority.test.ts`   | Low-lead protection with fake clocks                |
| `apps/server/test/network/extractorShare.test.ts`      | Aggregate share, risk suspension and no reservation |
| `apps/server/test/net.test.ts`                         | Virtual/link-local fallback and ranking             |
| `apps/server/test/discovery.test.ts`                   | A/AAAA replacement and advertised records           |

## Measured scope

Historical snapshot dated **2026-11-08**, revision **`0a8f04f`**: scoped `git ls-tree` counts **7 network `.ts` source / 8 matching `*.test.ts` files**, ratio **1.14**. Adjacent LAN discovery scope is **2 source / 2 test files** (`apps/server/src/net.ts`, `apps/server/src/discovery.ts` and their root tests). Proxy/playback, helpers and integration elsewhere are excluded. CODEOWNERS and supplied default-branch history identify **1 unique human**, excluding bots, not an ownership guarantee. No tests, mDNS publication or bandwidth measurements were run.
