# Encoding and compatibility

Active contributors: VeroxAUS (origin/main sole human)

The encoding pipeline probes actual streams, chooses a device-compatible output, and runs NVENC-backed FFmpeg on a stable four-second HLS grid. Source labels are not the authority for codec or HDR decisions.

## Layout and key abstractions

`ProbeResult` contains duration, the first real video stream, all audio tracks, and recognized text/bitmap subtitles. `Decision` separates policy from command construction. `EncodeJob` combines that decision with source stream indexes, starting segment, tone mapper, and optional bitmap burn target.

`apps/server/src/playback/probe.ts` skips attached pictures and image codecs, derives frame rate from valid 5–121 fps rates (otherwise 24), reads case-insensitive language/title tags, and requires positive duration. Input analysis uses `-probesize 8M -analyzeduration 3M`; ffprobe defaults to a 60-second timeout. Unknown video or duration is rejected, not streamed as an unbounded live input.

## Output decision flow

| Concern | Implemented rule |
| --- | --- |
| Codec | Device `hevc` chooses HEVC; otherwise H.264, regardless of input codec |
| Size | Fit within device width/height without upscaling, keeping aspect ratio and even dimensions |
| HDR retention | HDR10, or Dolby Vision other than profile 5, plus device HEVC, HDR10, and HEVC Main10 support |
| Tone mapping | Any non-SDR source not eligible for retained HDR becomes SDR; includes HLG and DV profile 5 |
| Audio | AAC, 48 kHz; TV up to device/source limit and 6 channels; other kinds at most stereo |
| No audio | No audio output when no audio track is selected/present |
| Audio choice | Explicit valid index, else default English, first English, default track, first track |

HDR detection uses PQ transfer (`smpte2084`), HLG transfer (`arib-std-b67`), and Dolby Vision side data; profile 5 is recognized even without a specified transfer. Output retained HDR is **HDR10**, not Dolby Vision passthrough. The DV retention predicate is the implemented profile rule, not a full base-layer validator.

## Hardware and FFmpeg requirements

Both video paths always use **`hevc_nvenc` or `h264_nvenc`**. Software decode fallback does **not** mean software encoding fallback: the implementation still requires a compatible NVIDIA encoder/driver and FFmpeg build.

- Eligible decode uses CUDA/NVDEC and `scale_cuda`. The codec allowlist is H.264, HEVC, VP9, AV1, MPEG-2 video, MPEG-4, VC-1, and VP8; pixel formats are explicitly allowlisted. H.264/MPEG-2/MPEG-4 10/12-bit inputs are rejected for hardware decode, as are unsupported chroma formats.
- Software decode paths scale with CPU `scale`, but still feed NVENC.
- Default tone mapping initializes **Vulkan** and uses **libplacebo**, BT.2390, output BT.709. CUDA-decoded frames are downloaded and uploaded to the filter device; this is not an entirely zero-copy path.
- Fallback tone mapping initializes **OpenCL** and uses `tonemap_opencl` with Hable, then CPU scaling. It requires that device/filter support too.
- HDR10 uses HEVC Main10 and p010 frames; SDR HEVC uses Main, H.264 uses High. HEVC is tagged `hvc1`. Bitstream filters write BT.2020/PQ HDR or BT.709 tone-mapped stream metadata because the code does not rely on NVENC honoring `-color_*` flags.

No universal hardware-capability negotiation or alternate software video encoder is selected here. Consult [lifecycle recovery](lifecycle.md) for the one-time Vulkan-to-OpenCL fallback, not an assurance any machine can encode.

## Rate control and segment timing

Video uses preset `p4`, tune `hq`, VBR, CQ 24 (HEVC) or 23 (H.264), no B-frames, and a buffer twice the maximum bitrate.

| Output-height threshold | HEVC target / maximum kbps | H.264 target / maximum kbps |
| --- | --- | --- |
| ≥1800 | 20,000 / 30,000 | 28,000 / 40,000 |
| ≥900 | 8,000 / 12,000 | 10,000 / 15,000 |
| ≥600 | 5,000 / 8,000 | 5,000 / 8,000 |
| Below 600 | 2,500 / 4,000 | 2,500 / 4,000 |

AAC is 192 kbps through stereo, otherwise 64 kbps per channel. These are encoding policy values, not measured bandwidth.

`ceil(fps × 4)` sets GOP and minimum key interval, with forced IDR/keyframes every four seconds. HLS uses temporary-file publication and independent segments. HEVC's fMP4 `movflags=+frag_discont` keeps fragment timestamps absolute across seeks so one stable init can describe multiple runs. MPEG-TS disables mux delay/preload to avoid a 1.4-second timeline offset.

A restart at segment N input-seeks to N×4 seconds and sets output timestamp offset and numbering accordingly. Bitmap burn-in reads up to **10 seconds earlier**, then trims that lead-in after input, preserving a cue already active at the seek point. See [subtitles](subtitles.md).

## Integrations and modification entry points

Change compatibility/rates in `apps/server/src/playback/decision.ts`; inspect `apps/server/src/playback/probe.ts` when supporting new metadata/codecs. Change filter graphs and output timing in `apps/server/src/playback/ffmpegArgs.ts`, preserving playlist naming, seek offsets, and [source proxy](../source-proxy.md) inputs. Configuration only chooses binary paths; see [configuration](../../reference/configuration.md).

The working tree has pre-existing uncommitted changes to `apps/server/src/playback/ffmpegArgs.ts` and its unit test. This page describes the inspected working tree, including the width-≥3840 retained-HDR burn-in optimization; it does not claim that optimization is committed on `origin/main`.

## Measured scope and evidence

Shared playback subsystem footprint: **20 source `.ts` / 16 `*.test.ts` / 2 helper `.ts` files**, recursively enumerated in `apps/server/src/playback`, `apps/server/test/playback`, and `apps/server/test/encode`; **1 unique committer** from scoped `origin/main` `%cn <%ce>` history. This is the entire playback subsystem, not a disjoint encoding-only count.

`apps/server/test/playback/decision.test.ts` and `apps/server/test/playback/ffmpegArgs.test.ts` express policy/argument expectations; `apps/server/test/encode/hls-encode.test.ts` inspects encoded codec, pixel format, color tags, timing, and dimensions. These tests were read, **not run**. An assertion title describing a software tone-map path does not override the actual Vulkan/libplacebo graph.

## Key source files

| Repository-root path | Role |
| --- | --- |
| `apps/server/src/playback/probe.ts` | Actual stream metadata and bounded probing |
| `apps/server/src/playback/decision.ts` | Codec/HDR/size/audio/bitrate policy |
| `apps/server/src/playback/ffmpegArgs.ts` | Decode, filters, NVENC, HLS, and seek flags |
| `apps/server/src/playback/playlist.ts` | Codec-to-container mapping |
| `apps/server/test/playback/ffmpegArgs.test.ts` | Argument/filter regression expectations |
| `apps/server/test/encode/hls-encode.test.ts` | Real-media output expectations |
