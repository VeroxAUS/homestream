import type {
  AudioTrack,
  CapabilityProfile,
  Decision,
  SessionStartRequest,
  StartAttempt,
  SubtitleSelection,
} from '@homestream/shared';
import { mediaKeyFor, type PlayStart } from '../db/plays.js';
import type { SourceHandle } from '../sourceproxy/proxy.js';
import type { ResolvedStream } from '../streams/service.js';
import type { chooseDefaultSubtitle } from './defaultSubtitle.js';
import type { ProbeResult } from './probe.js';
import type { SegmentFormat } from './playlist.js';
import { SegmentStore } from './segmentStore.js';
import type { SessionRecord } from './session.js';
import type { StartTimeline } from './startTimeline.js';
import type { TextTrack } from './subtitleExtractor.js';
import type { TitleDetails } from './support.js';

export interface SessionRecordInput {
  id: string;
  dir: string;
  body: SessionStartRequest;
  clientIp: string | null;
  stream: ResolvedStream;
  source: SourceHandle;
  device: CapabilityProfile;
  details: TitleDetails;
  title: { title: string; showTitle: string | null; stillUrl: string | null };
  probe: ProbeResult;
  decision: Decision;
  format: SegmentFormat;
  audio: AudioTrack | null;
  subtitle: SubtitleSelection | null;
  automatic: ReturnType<typeof chooseDefaultSubtitle>;
  textTracks: TextTrack[];
  startSegment: number;
  attempts: StartAttempt[];
  timeline: StartTimeline;
  toneMapper: SessionRecord['toneMapper'];
  now: number;
}

/** The record of a session that is about to start its encoder: nothing has run yet. */
export function createSessionRecord(input: SessionRecordInput): SessionRecord {
  const { body, stream, details, title, startSegment, now } = input;
  return {
    id: input.id,
    dir: input.dir,
    meta: {
      mediaKey: mediaKeyFor(body.mediaType, body.tmdbId, body.season, body.episode),
      mediaType: body.mediaType,
      tmdbId: body.tmdbId,
      title: title.title,
      showTitle: title.showTitle,
      season: body.season ?? null,
      episode: body.episode ?? null,
      streamFilename: stream.stream.filename,
      clientIp: input.clientIp,
      posterUrl: details.posterUrl,
      backdropUrl: title.stillUrl ?? details.backdropUrl,
    },
    store: new SegmentStore(input.dir),
    device: input.device,
    source: input.source,
    probe: input.probe,
    decision: input.decision,
    format: input.format,
    selectedAudioIndex: input.audio?.index ?? null,
    selectedSubtitle: input.subtitle,
    subtitleDefault: input.automatic?.kind ?? null,
    defaultForced: input.automatic?.forced ?? false,
    textTracks: input.textTracks,
    requestedStartSec: body.startPositionSec ?? 0,
    startedAt: now,
    streamId: stream.id,
    attempts: [...input.attempts],
    opening: true,
    startTimeline: input.timeline,
    state: 'starting',
    error: null,
    errorCode: null,
    stats: { fps: 0, speed: 0, bitrateKbps: 0, outTimeSec: 0, headSegment: startSegment },
    statSamples: { speedSum: 0, speedCount: 0, bitrateSum: 0, bitrateCount: 0 },
    toneMapper: input.toneMapper,
    process: null,
    subtitles: null,
    startSegment,
    generation: 0,
    retried: false,
    encoderDone: false,
    stopping: false,
    stopController: new AbortController(),
    restart: null,
    parked: false,
    lastActivity: now,
    positionSec: body.startPositionSec ?? 0,
    pingedAt: 0,
    playerSegment: startSegment,
    watchedSec: 0,
    pingState: 'playing',
    pingClock: now,
    bytesServed: 0,
  };
}

/** The `plays` row written when a session's encoder is about to start. */
export function playStartOf(rec: SessionRecord): PlayStart {
  const { meta, device } = rec;
  return {
    sessionId: rec.id,
    mediaKey: meta.mediaKey,
    type: meta.mediaType,
    tmdbId: meta.tmdbId,
    title: meta.title,
    showTitle: meta.showTitle,
    season: meta.season,
    episode: meta.episode,
    deviceId: device.deviceId,
    deviceName: device.deviceName,
    deviceKind: device.kind,
    clientIp: meta.clientIp,
    startedAt: rec.startedAt,
    durationSec: rec.probe.durationSec,
    streamFilename: meta.streamFilename,
    decision: rec.decision,
  };
}
