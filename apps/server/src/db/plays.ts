import type { Decision } from '@homestream/shared';
import type { Db } from './index.js';

export interface PlayStart {
  sessionId: string;
  mediaKey: string;
  type: 'movie' | 'tv';
  tmdbId: number;
  title: string;
  showTitle: string | null;
  season: number | null;
  episode: number | null;
  deviceId: string;
  deviceName: string;
  deviceKind: string;
  clientIp: string | null;
  startedAt: number;
  durationSec: number;
  streamFilename: string;
  decision: Decision;
}

export interface PlayEnd {
  endedAt: number;
  status: 'ok' | 'error';
  errorMessage?: string | null;
  avgBitrateKbps?: number | null;
  avgSpeed?: number | null;
}

export function mediaKeyFor(type: 'movie' | 'tv', tmdbId: number, season?: number | null, episode?: number | null): string {
  return type === 'movie' ? `movie:${tmdbId}` : `tv:${tmdbId}:${season}:${episode}`;
}

export function insertPlay(db: Db, play: PlayStart): void {
  const source = play.decision.sourceVideo;
  db.prepare(
    `INSERT INTO plays (
       session_id, media_key, type, tmdb_id, title, show_title, season, episode,
       device_id, device_name, device_kind, client_ip, started_at, duration_sec, stream_filename,
       source_resolution, source_codec, source_hdr, source_audio, decision_json, status
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ok')`,
  ).run(
    play.sessionId,
    play.mediaKey,
    play.type,
    play.tmdbId,
    play.title,
    play.showTitle,
    play.season,
    play.episode,
    play.deviceId,
    play.deviceName,
    play.deviceKind,
    play.clientIp,
    play.startedAt,
    play.durationSec,
    play.streamFilename,
    `${source.height}p`,
    source.codec,
    source.hdr,
    `${play.decision.sourceAudio.codec} ${play.decision.sourceAudio.channels}ch`,
    JSON.stringify(play.decision),
  );
}

/** Keeps the stored decision in step with track switches (audio channels, burn-in). */
export function updatePlayDecision(db: Db, sessionId: string, decision: Decision): void {
  db.prepare('UPDATE plays SET decision_json = ? WHERE session_id = ?').run(JSON.stringify(decision), sessionId);
}

/** Removes the row of a start that was given up before the client ever got a session. */
export function deletePlay(db: Db, sessionId: string): void {
  db.prepare('DELETE FROM plays WHERE session_id = ?').run(sessionId);
}

export function finalizePlay(db: Db, sessionId: string, end: PlayEnd): void {
  db.prepare(
    `UPDATE plays SET ended_at = ?, status = ?, error_message = ?, avg_bitrate_kbps = ?, avg_speed = ?
     WHERE session_id = ? AND ended_at IS NULL`,
  ).run(end.endedAt, end.status, end.errorMessage ?? null, end.avgBitrateKbps ?? null, end.avgSpeed ?? null, sessionId);
}
