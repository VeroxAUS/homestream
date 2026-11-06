# Encoding

Active contributors: VeroxAUS

HomeStream probes actual media, chooses a device-compatible output and always re-encodes video with NVENC. Decode fallback and tone-map fallback do not provide a software video encoder (`apps/server/src/playback/probe.ts`, `apps/server/src/playback/decision.ts`, `apps/server/src/playback/ffmpegArgs.ts`).

## Layout and key abstractions

`ProbeResult` describes duration, the first real video stream, audio and supported subtitle tracks. Pure `decide()` produces a shared `Decision`; `EncodeJob` adds input/output locations, stream indexes, start segment, tone mapper, burn target and thread caps. `buildFfmpegArgs()` builds the command; `EncoderProcess` owns its child lifetime.

Probe skips attached pictures/image codecs, reads case-insensitive language/title tags and requires a positive duration. Valid frame rates are 5–121 fps; otherwise it uses 24. Both probe and encoder bound input analysis with `-probesize 8M -analyzeduration 3M`; ffprobe's default timeout is **60 seconds** (`apps/server/src/playback/probe.ts`).

## Output policy

| Concern        | Rule in `apps/server/src/playback/decision.ts`                                                      |
| -------------- | --------------------------------------------------------------------------------------------------- |
| Video codec    | HEVC if the device advertises HEVC; otherwise H.264, independent of source codec                    |
| Dimensions     | Fit inside device width/height; preserve aspect ratio, even dimensions, never upscale               |
| Retain HDR     | Source HDR10, or Dolby Vision with profile other than 5, plus device HEVC, HDR10 and Main10 support |
| Tone map       | Every non-SDR source that cannot retain HDR, including HLG and DV profile 5, becomes SDR            |
| Audio          | AAC at 48 kHz; TV capped by source/device and 6 channels, other device kinds at most stereo         |
| No audio track | Disable audio output                                                                                |
| Audio default  | Requested valid index; otherwise default English, first English, default track, first track         |

PQ transfer identifies HDR10/DV; HLG transfer and Dolby Vision side data are read from the stream. DV profile 5 is recognized even without a specified transfer. Retained output is **HDR10**, not Dolby Vision passthrough; the profile rule is not a full HDR base-layer validator (`apps/server/src/playback/probe.ts`, `apps/server/src/playback/decision.ts`).

[Automatic subtitle defaults](subtitles.md) use the chosen audio and TMDB original language. Burn-in affects filters and restart requirements, not the fundamental codec choice.

## Decode and filter paths

| Workload                          | Decode/filter behavior in `apps/server/src/playback/ffmpegArgs.ts`                                                         |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Ordinary compatible input         | CUDA/NVDEC decode, `scale_cuda`, NVENC                                                                                     |
| Unsupported hardware-decode input | Software decode/CPU scale, still NVENC                                                                                     |
| Default HDR-to-SDR                | Vulkan `libplacebo`, BT.2390 to BT.709, with transfers between CUDA/system/Vulkan memory as needed                         |
| Tone-map recovery                 | OpenCL `tonemap_opencl`, Hable, download and CPU scaling, still NVENC                                                      |
| Bitmap burn-in                    | Software-accessible frames and overlay after scale/tone mapping; retained-HDR output width ≥3840 uses NVDEC when supported |

Hardware-decode codec allowlist: H.264, HEVC, VP9, AV1, MPEG-2 video, MPEG-4, VC-1 and VP8. Pixel formats are allowlisted too; H.264/MPEG-2/MPEG-4 10/12-bit and unsupported chroma formats use software decode. These checks do not probe every installed GPU capability.

Video is always `hevc_nvenc` or `h264_nvenc`. HEVC HDR uses Main10/p010, SDR HEVC uses Main, H.264 uses High, and HEVC carries `hvc1`. Bitstream filters write retained BT.2020/PQ or tone-mapped BT.709 stream metadata because NVENC color flags alone are not relied upon (`apps/server/src/playback/ffmpegArgs.ts`).

A libplacebo run that fails before its first segment switches once to OpenCL, and subsequent sessions on that manager start with OpenCL. Both paths still need the matching FFmpeg/device support; there is no universal hardware negotiation or CPU encode escape hatch. See [recovery](lifecycle.md).

## Rate control

Both encoders use preset `p4`, tune `hq`, VBR, no B-frames, a buffer twice maximum bitrate, and CQ 24 for HEVC or 23 for H.264 (`apps/server/src/playback/ffmpegArgs.ts`).

| Output-height threshold | HEVC target / max kbps | H.264 target / max kbps |
| ----------------------- | ---------------------: | ----------------------: |
| ≥1800                   |        20,000 / 30,000 |         28,000 / 40,000 |
| ≥900                    |         8,000 / 12,000 |         10,000 / 15,000 |
| ≥600                    |          5,000 / 8,000 |           5,000 / 8,000 |
| Below 600               |          2,500 / 4,000 |           2,500 / 4,000 |

AAC uses 192 kbps through stereo or 64 kbps per channel above stereo, with asynchronous resampling. These are policy targets, not observed network rates (`apps/server/src/playback/decision.ts`, `apps/server/src/playback/ffmpegArgs.ts`). The [global download cap](../network.md) applies to source bytes, which can have a much higher bitrate.

## HLS grid and seeks

Segments use a **4-second** grid. GOP/minimum key interval is `ceil(fps × 4)` with forced IDR/keyframes at each four-second boundary. FFmpeg publishes through temporary files with independent-segment flags (`apps/server/src/playback/ffmpegArgs.ts`, `apps/server/src/playback/playlist.ts`).

Restart at segment N input-seeks to N×4, numbers output from N and applies the absolute timestamp offset. MPEG-TS disables mux delay/preload to avoid a 1.4-second offset. HEVC/fMP4 uses `movflags=+frag_discont` so fragments from separate runs have absolute times and can reuse one complete init. [Lifecycle](lifecycle.md) explains safe init publication.

Bitmap burn-in input-seeks up to **10 seconds earlier**, then trims that lead-in at output. This preserves a cue already active at the seek point within the bounded preroll. Subtitle canvases are frame-rate-limited before scaling to avoid high-packet-rate audio flooding FFmpeg's overlay queue; retained HDR overlays stay in 10-bit YUV. Details are in [subtitles](subtitles.md).

## CPU and memory safety

Default thread caps are **4** for GPU-oriented jobs and **8** for burn-in, software decode or the OpenCL/CPU-filter path. The chosen cap is applied to `-threads`, `-filter_threads` and `-filter_complex_threads` before input. Subtitle extraction uses its own two-thread setting (`apps/server/src/config.ts`, `apps/server/src/playback/ffmpegArgs.ts`, `apps/server/src/playback/subtitleRun.ts`).

Video, extraction and probing lower process priority best-effort. Every managed encoder/extractor is watched for RSS; **4096 MiB per FFmpeg process** is the default, not a combined server budget. [Lifecycle protections](lifecycle.md) cover enforcement and limitations (`apps/server/src/playback/priority.ts`, `apps/server/src/playback/memoryWatchdog.ts`).

## Change and test pointers

Change compatibility/rates in `apps/server/src/playback/decision.ts`, metadata parsing in `apps/server/src/playback/probe.ts`, and graphs/timing in `apps/server/src/playback/ffmpegArgs.ts`. Keep absolute timestamps, ready-init compatibility and the loopback source input intact. Binary/thread settings are listed in [configuration](../../reference/configuration.md).

Playback-wide footprint: **27 source / 24 test / 4 helper files**, test/code ratio **0.89**, **1 unique human author** on scoped `origin/main`; see [counting definitions](../index.md). This is not an encoding-only allocation.

Unit tests assert decision matrices, filters, subtitle frame-rate limiting, thread caps and seek flags. Real GPU tests inspect codec, dimensions, tags and timelines. Tests were inspected, not executed; test names cannot override the actual filter implementation.

## Key source files

| Repository-root path                           | Role                                         |
| ---------------------------------------------- | -------------------------------------------- |
| `apps/server/src/playback/probe.ts`            | Bounded probing and actual stream metadata   |
| `apps/server/src/playback/decision.ts`         | Device output and bitrate policy             |
| `apps/server/src/playback/ffmpegArgs.ts`       | Decode/filter/NVENC/HLS command construction |
| `apps/server/src/playback/encoderProcess.ts`   | Managed child process                        |
| `apps/server/src/playback/playlist.ts`         | Codec/container and timeline rules           |
| `apps/server/test/playback/decision.test.ts`   | Compatibility policy regressions             |
| `apps/server/test/playback/ffmpegArgs.test.ts` | Filter, threading and timestamp expectations |
| `apps/server/test/encode/hls-encode.test.ts`   | Encoded output validation                    |
