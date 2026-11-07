import type { EncoderStats, SessionResponse, SubtitleSelection } from '@homestream/shared';
import { useEffect, useState } from 'react';
import { describeDecision, describeEncoder, subtitleModeLabel } from './decisionText';
import { fetchSession } from './sessionApi';
import styles from './InfoPanel.module.css';

const STATS_REFRESH_MS = 4000;

/** Encoder speed while the panel is open. It polls only then, so playback itself makes no extra requests. */
function useEncoderStats(session: SessionResponse): EncoderStats {
  const [encoder, setEncoder] = useState(session.encoder);
  useEffect(() => {
    const controller = new AbortController();
    const refresh = () => {
      fetchSession(session.sessionId, controller.signal).then(
        (next) => setEncoder(next.encoder),
        () => undefined,
      );
    };
    const timer = window.setInterval(refresh, STATS_REFRESH_MS);
    refresh();
    return () => {
      window.clearInterval(timer);
      controller.abort();
    };
  }, [session.sessionId]);
  return encoder;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.kv}>
      <span>{label}</span>
      {value}
    </div>
  );
}

interface InfoPanelProps {
  session: SessionResponse;
  subtitle: SubtitleSelection | null;
}

/** What the server decided: the source stream, what the player receives, and how fast the encoder runs. */
export function InfoPanel({ session, subtitle }: InfoPanelProps) {
  const text = describeDecision(session.decision);
  const encoder = describeEncoder(useEncoderStats(session));
  return (
    <section className={styles.panel} aria-label="Playback info" data-testid="player-info">
      <h4 className={styles.heading}>Playback info</h4>
      <div className={styles.flow}>
        <div>
          <div className={styles.label}>Source</div>
          <b data-testid="info-source">{text.sourceVideo}</b>
          <div className={styles.muted}>{text.sourceAudio}</div>
        </div>
        <div className={styles.arrow}>{'\u2193'} transcoding on server</div>
        <div>
          <div className={styles.label}>Output</div>
          <b data-testid="info-output">
            {text.outputVideo}
            {text.toneMapped ? <span className={styles.badge}>tone-mapped</span> : null}
          </b>
          <div className={styles.muted}>{text.outputAudio}</div>
        </div>
      </div>
      <Row label="Tone mapping" value={text.toneMapped ? 'yes' : 'no'} />
      <Row label="Encoder speed" value={encoder.speed} />
      <Row label="Frame rate" value={encoder.fps} />
      <Row label="Bitrate" value={encoder.bitrate} />
      <Row label="Subtitles" value={subtitleModeLabel(subtitle)} />
    </section>
  );
}
