import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import type { Handover } from '@homestream/shared';
import { Icon } from '../components/Icon';
import { desktopBridge, inMiniPlayer } from '../desktop/bridge';
import { useAttachedSession } from '../desktop/useAttachedSession';
import { NotFound } from '../components/NotFound';
import { describeError } from '../lib/errors';
import { INFO_TOAST_MS, showToast } from '../notices/toastStore';
import { outputSummary } from '../player/decisionText';
import { markDownloading } from '../player/downloading';
import { Playback } from '../player/Playback';
import { PlayerBusy, PlayerError } from '../player/PlayerOverlays';
import { BAR_ATTRIBUTE } from '../player/useIdleChrome';
import { useFullscreen } from '../player/usePlayerActions';
import { useSessionStart, type StartAttempt, type StartState } from '../player/useSessionStart';
import { useTitleMeta, type TitleMeta } from '../player/useTitleMeta';
import { detailsPath, parsePlayTarget, parseStartParam, type PlayTarget } from '../player/target';
import styles from '../player/Player.module.css';

interface TopBarProps {
  title: string;
  line: string;
  /** The desktop window covers the top-right corner with its caption buttons, outside fullscreen. */
  clearCaptionButtons: boolean;
  onBack: () => void;
}

function TopBar({ title, line, clearCaptionButtons, onBack }: TopBarProps) {
  return (
    <div
      className={`${styles.top} ${clearCaptionButtons ? styles.topDesktop : ''} chrome`}
      data-testid="player-topbar"
      {...{ [BAR_ATTRIBUTE]: '' }}
    >
      <button type="button" className={styles.back} aria-label="Back" onClick={onBack}>
        <Icon name="back" size={22} />
      </button>
      <div className={styles.titleBlock}>
        <h1 className={styles.title}>{title}</h1>
        {line ? <div className={styles.sub}>{line}</div> : null}
      </div>
    </div>
  );
}

/** Esc leaves the player from the loading and error screens; once playing, the player's own key handler decides. */
function useEscapeToLeave(active: boolean, onLeave: () => void): void {
  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onLeave();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [active, onLeave]);
}

/** A 202 answer: TorBox is caching the title. Say so, mark the details page and return to it. */
function useDownloadingHandoff(state: StartState, target: PlayTarget, leave: () => void): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (state.status !== 'downloading') return;
    const { download } = state;
    markDownloading(queryClient, target, download);
    showToast({
      kind: 'info',
      message: 'Downloading, try again later',
      detail: `TorBox is caching ${download.title}. We'll let you know when it's ready.`,
      actions: [],
      autoDismissMs: INFO_TOAST_MS,
    });
    leave();
  }, [state, queryClient, target, leave]);
}

interface ScreenProps {
  state: StartState;
  target: PlayTarget;
  meta: TitleMeta;
  line: string;
  stageRef: RefObject<HTMLElement | null>;
  fullscreen: boolean;
  handover: Handover | null;
  onLeave: () => void;
  onRetry: (startSec?: number) => void;
}

function Screen({ state, target, meta, line, stageRef, fullscreen, handover, onLeave, onRetry }: ScreenProps) {
  if (state.status === 'ready') {
    return (
      <Playback
        key={state.session.sessionId}
        session={state.session}
        target={target}
        meta={meta}
        line={line}
        stageRef={stageRef}
        fullscreen={fullscreen}
        handover={handover}
        onHandedOver={onLeave}
        onLeave={onLeave}
        onRetry={onRetry}
      />
    );
  }
  if (state.status === 'error') {
    const { message, hint } = describeError(state.error);
    return (
      <PlayerError
        title="Couldn't start this title"
        message={message}
        {...(hint ? { hint } : {})}
        retryLabel="Retry"
        onRetry={() => onRetry()}
        onBack={onLeave}
      />
    );
  }
  return <PlayerBusy headline="Starting playback..." detail="The server is preparing the video." />;
}

interface RouteProps {
  target: PlayTarget;
  startSec: number | undefined;
  /** Desktop app: the session is handed over by the other window instead of being started here. */
  attach: boolean;
}

function PlayerRoute({ target, startSec, attach }: RouteProps) {
  const navigate = useNavigate();
  const stageRef = useRef<HTMLDivElement>(null);
  const [attempt, setAttempt] = useState<StartAttempt>({ n: 0, startSec });
  const attached = useAttachedSession(attach);
  const attaching = attach && !attached.gaveUp;
  const started = useSessionStart(target, attempt, !attaching);
  const state = attaching ? attached.state : started;
  const meta = useTitleMeta(target);
  const fullscreen = useFullscreen(stageRef);
  const mini = inMiniPlayer();

  const leave = useCallback(() => {
    if (mini) void desktopBridge()?.closeMiniPlayer();
    else navigate(detailsPath(target), { replace: true });
  }, [navigate, target, mini]);
  const { giveUp } = attached;
  const handedOverSec = attached.handover?.positionSec;
  const retry = useCallback(
    (resumeSec?: number) => {
      // The attached session is not started by this page, so Retry replaces it with a new one at the same position.
      if (attaching) giveUp();
      setAttempt((old) => ({
        n: old.n + 1,
        startSec: resumeSec ?? (attaching ? handedOverSec : undefined) ?? old.startSec,
      }));
    },
    [attaching, giveUp, handedOverSec],
  );
  useDownloadingHandoff(state, target, leave);
  useEscapeToLeave(state.status !== 'ready', leave);

  const summary = state.status === 'ready' ? outputSummary(state.session.decision) : '';
  const line = [meta.line, summary].filter(Boolean).join(' \u00b7 ');
  const clearCaptionButtons = Boolean(window.homestream?.isDesktop) && !fullscreen;
  return (
    <div
      ref={stageRef}
      className={`${styles.stage} ${mini ? styles.mini : ''}`}
      data-chrome="visible"
      data-testid="player-stage"
    >
      {mini ? null : (
        <TopBar title={meta.title ?? ''} line={line} clearCaptionButtons={clearCaptionButtons} onBack={leave} />
      )}
      <Screen
        state={state}
        target={target}
        meta={meta}
        line={line}
        stageRef={stageRef}
        fullscreen={fullscreen}
        handover={attaching ? attached.handover : null}
        onLeave={leave}
        onRetry={retry}
      />
    </div>
  );
}

/** `/play/movie/:id` and `/play/tv/:id/:season/:episode`, optionally with `?start=<seconds>` to resume. */
export default function PlayerPage() {
  const splat = useParams()['*'];
  const [search] = useSearchParams();
  const target = useMemo(() => parsePlayTarget(splat), [splat]);
  const startSec = parseStartParam(search.get('start'));
  if (!target) {
    return (
      <NotFound title="Nothing to play here" message="This player address does not point to a movie or episode." />
    );
  }
  const attach = search.get('attach') === '1' && desktopBridge() !== null;
  return <PlayerRoute key={splat} target={target} startSec={startSec} attach={attach} />;
}
