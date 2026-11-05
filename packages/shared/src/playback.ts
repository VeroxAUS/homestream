import { z } from 'zod';
import { MediaTypeSchema } from './catalog.js';
import { CapabilityProfileSchema } from './schemas.js';

export const SOURCE_HDR_VALUES = ['dv', 'hdr10', 'hlg', 'sdr'] as const;
export const SourceHdrSchema = z.enum(SOURCE_HDR_VALUES);
export type SourceHdr = z.infer<typeof SourceHdrSchema>;

export const SubtitleModeSchema = z.enum(['sidecar', 'burn']);
export type SubtitleMode = z.infer<typeof SubtitleModeSchema>;

export const SubtitleSelectionSchema = z.object({
  index: z.number().int().min(0),
  mode: SubtitleModeSchema,
});
export type SubtitleSelection = z.infer<typeof SubtitleSelectionSchema>;

export const SessionStartRequestSchema = z
  .object({
    mediaType: MediaTypeSchema,
    tmdbId: z.number().int().positive(),
    season: z.number().int().min(0).optional(),
    episode: z.number().int().min(1).optional(),
    streamId: z.string().trim().min(1).max(64),
    device: CapabilityProfileSchema,
    startPositionSec: z.number().min(0).max(86400).optional(),
    audioIndex: z.number().int().min(0).optional(),
    subtitle: SubtitleSelectionSchema.nullable().optional(),
  })
  .refine((body) => body.mediaType === 'movie' || (body.season !== undefined && body.episode !== undefined), {
    message: 'season and episode are required for tv',
    path: ['season'],
  });
export type SessionStartRequest = z.infer<typeof SessionStartRequestSchema>;

export const DecisionSchema = z.object({
  videoCodec: z.enum(['hevc', 'h264']),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  dynamicRange: z.enum(['hdr10', 'sdr']),
  toneMapped: z.boolean(),
  audioCodec: z.literal('aac'),
  audioChannels: z.number().int().nonnegative(),
  subtitleBurnIn: z.boolean(),
  sourceVideo: z.object({
    codec: z.string(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    hdr: SourceHdrSchema,
  }),
  sourceAudio: z.object({
    codec: z.string(),
    channels: z.number().int().nonnegative(),
  }),
});
export type Decision = z.infer<typeof DecisionSchema>;

export const AudioTrackSchema = z.object({
  index: z.number().int().min(0),
  codec: z.string(),
  channels: z.number().int().nonnegative(),
  language: z.string(),
  title: z.string(),
  default: z.boolean(),
});
export type AudioTrack = z.infer<typeof AudioTrackSchema>;

export const SubtitleTrackSchema = z.object({
  index: z.number().int().min(0),
  language: z.string(),
  title: z.string(),
  kind: z.enum(['text', 'bitmap']),
  forced: z.boolean(),
  default: z.boolean(),
  url: z.string().nullable(),
});
export type SubtitleTrack = z.infer<typeof SubtitleTrackSchema>;

export const EncoderStatsSchema = z.object({
  fps: z.number(),
  speed: z.number(),
  bitrateKbps: z.number(),
  outTimeSec: z.number(),
  headSegment: z.number().int().nonnegative(),
});
export type EncoderStats = z.infer<typeof EncoderStatsSchema>;

export const SESSION_STATES = ['starting', 'ready', 'playing', 'paused', 'stopped', 'error'] as const;
export const SessionStateSchema = z.enum(SESSION_STATES);
export type SessionState = z.infer<typeof SessionStateSchema>;

export const SessionResponseSchema = z.object({
  sessionId: z.string(),
  playlistUrl: z.string(),
  durationSec: z.number().positive(),
  startPositionSec: z.number().min(0),
  state: SessionStateSchema,
  decision: DecisionSchema,
  audioTracks: z.array(AudioTrackSchema),
  subtitleTracks: z.array(SubtitleTrackSchema),
  selectedAudioIndex: z.number().int().nullable(),
  selectedSubtitle: SubtitleSelectionSchema.nullable(),
  encoder: EncoderStatsSchema,
  error: z.object({ message: z.string(), hint: z.string().optional() }).nullable(),
});
export type SessionResponse = z.infer<typeof SessionResponseSchema>;
