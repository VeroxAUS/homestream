# Encoding

Active contributors: VeroxAUS

## Purpose

HomeStream always re-encodes video with NVENC. `decide` in `apps/server/src/playback/decision.ts` chooses device output; `buildFfmpegArgs` in `apps/server/src/playback/ffmpegArgs.ts` constructs decoding, color conversion, audio and HLS arguments.

## Probe and output policy

`ProbeResult` in `apps/server/src/playback/probe.ts` supplies actual video/audio/subtitle metadata, skipping image/attached-picture video streams. Filename hints from discovery do not replace probing.

| Concern | Policy |
| --- | --- |
| Codec | HEVC when advertised by device, otherwise H.264 |
| Dimensions | Preserve aspect ratio, even dimensions, fit device limits, never upscale |
| HDR | Keep HDR10, HLG or non-profile-5 Dolby Vision as HDR10 only with HEVC/Main10/HDR10 capability |
| SDR conversion | Tone-map other non-SDR inputs |
| Audio | AAC; TV up to source/device limit and 6 channels, other clients at most stereo |
| Default audio | Valid requested track; otherwise default English, English, default, first |

The policy and bitrate tables live in `apps/server/src/playback/decision.ts`. A source without audio disables audio output. Retained Dolby Vision is HDR10 output, not Dolby Vision passthrough.

## Real HLG-to-PQ conversion

`needsHlgToPq` in `apps/server/src/playback/decision.ts` distinguishes retained HLG from ordinary HDR10. `apps/server/src/playback/ffmpegArgs.ts` converts pixels to PQ/BT.2020 with libplacebo before tagging HDR10. It does not merely relabel the HLG transfer.

If the libplacebo start fails before its first segment, recovery switches to the alternate filter path and remembers that choice for later sessions (`apps/server/src/playback/recovery.ts`, `apps/server/src/playback/context.ts`). HLG's alternate path uses software-decoded **zscale**, HLG input to SMPTE 2084 output with nominal peak **1000 nits**, yielding p010. The alternate HDR-to-SDR path instead uses OpenCL/Hable. Both still encode through NVENC; neither is a software video-encoder fallback.

## Decode, filters and burn-in

`apps/server/src/playback/ffmpegArgs.ts` allowlists hardware-decode codecs and pixel formats. Unsupported inputs use software decode. Ordinary supported jobs use CUDA decode/scale; libplacebo uses Vulkan transfers as needed.

Bitmap subtitles overlay after output scaling/color conversion. Their input canvases are resampled to video frame rate before scaling to avoid redundant overlay frames. Retained HDR burn-in uses 10-bit YUV and reference-white scaling. The special high-resolution retained-HDR GPU burn path excludes HLG conversion. See [subtitles](subtitles.md).

## HLS timing and rate control

Video uses NVENC preset p4, HQ tuning, VBR, no B-frames and a buffer twice maximum bitrate (`apps/server/src/playback/ffmpegArgs.ts`). Rate targets from `apps/server/src/playback/decision.ts` are policies, not measured throughput:

| Output height | HEVC target/max kbps | H.264 target/max kbps |
| --- | ---: | ---: |
| ≥1800 | 20000/30000 | 28000/40000 |
| ≥900 | 8000/12000 | 10000/15000 |
| ≥600 | 5000/8000 | 5000/8000 |
| Lower | 2500/4000 | 2500/4000 |

AAC is 48 kHz, 192 kbps through stereo or 64 kbps per channel above stereo.

`apps/server/src/playback/playlist.ts` defines the **four-second** segment grid. FFmpeg uses matching forced keyframes, temporary-file publication and independent segments. HEVC/fMP4 uses absolute offsets and fragment discontinuity flags; MPEG-TS disables mux delay/preload. Restarts at segment N seek to N×4 and preserve absolute media time. Bitmap burn-in seeks up to ten seconds earlier and trims output to preserve already-active cues.

Thread settings select GPU-oriented versus CPU-filter/decode limits; these are concurrency hints, not CPU quotas (`apps/server/src/playback/ffmpegArgs.ts`, `apps/server/src/config.ts`). RSS protection and priority lowering are separate [lifecycle](lifecycle.md) controls.

## Modification entry points

Change compatibility/rates in `apps/server/src/playback/decision.ts`, probe interpretation in `apps/server/src/playback/probe.ts`, and actual graphs/timestamps in `apps/server/src/playback/ffmpegArgs.ts`. Update offline argument/decision tests before opt-in encoded-output tests. Preserve the loopback input, four-second grid and complete-init serving contract.

## Key source files

| File | Purpose |
| --- | --- |
| `apps/server/src/playback/decision.ts` | Output policy and HLG detection |
| `apps/server/src/playback/probe.ts` | Actual media metadata |
| `apps/server/src/playback/ffmpegArgs.ts` | Filters, NVENC and muxing |
| `apps/server/src/playback/playlist.ts` | Manifest/container rules |
| `apps/server/src/playback/recovery.ts` | Filter fallback |

## Measured scope

At `5eefa37`, committed playback source has **42 `.ts` files**; matching playback/encode test directories have **35 `*.test.ts` files**, ratio **0.83**. Method: scoped `git ls-files`, excluding helpers and integration elsewhere; this is playback-wide, not encoding-only. Default-branch history/CODEOWNERS identify **1 unique human author**, excluding bots. Tests were inspected, not executed.
