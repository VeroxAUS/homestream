import { useEffect, type RefObject } from 'react';
import { Icon } from '../components/Icon';
import { BAR_ATTRIBUTE } from './useIdleChrome';
import { SeekBar, TimeLabel } from './SeekBar';
import { TrackMenu, type MenuItem } from './TrackMenu';
import { SKIP_BACK_SEC, SKIP_FORWARD_SEC, type PlayerActions } from './usePlayerActions';
import type { VideoState } from './useVideoState';
import styles from './ControlBar.module.css';

export type MenuName = 'audio' | 'subtitles';

interface ControlBarProps {
  videoRef: RefObject<HTMLVideoElement | null>;
  durationSec: number;
  video: VideoState;
  actions: PlayerActions;
  fullscreen: boolean;
  menu: MenuName | null;
  onMenu: (menu: MenuName | null) => void;
  infoOpen: boolean;
  onInfo: () => void;
  /** Desktop app only: hand the session to the mini player. */
  onPopOut?: (() => void) | null;
  audioItems: MenuItem[];
  subtitleItems: MenuItem[];
}

interface RoundButtonProps {
  label: string;
  icon: Parameters<typeof Icon>[0]['name'];
  onClick: () => void;
  active?: boolean;
  pressed?: boolean;
  expanded?: boolean;
}

function RoundButton({ label, icon, onClick, active = false, pressed, expanded }: RoundButtonProps) {
  return (
    <button
      type="button"
      className={`${styles.round} ${active ? styles.on : ''}`}
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      aria-expanded={expanded}
      onClick={onClick}
    >
      <Icon name={icon} size={24} />
    </button>
  );
}

function Skip({ label, icon, onClick }: { label: string; icon: 'skipBack' | 'skipForward'; onClick: () => void }) {
  return (
    <button type="button" className={styles.skip} aria-label={label} title={label} onClick={onClick}>
      <Icon name={icon} size={22} />
      <span className={styles.skipText}>{label}</span>
    </button>
  );
}

/** Closes the open menu on a press anywhere outside the menu roots. */
function useCloseOnOutsidePress(open: boolean, close: () => void): void {
  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest('[data-menu-root]')) close();
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [open, close]);
}

export function ControlBar(props: ControlBarProps) {
  const { videoRef, durationSec, video, actions, fullscreen, menu, onMenu, infoOpen, onInfo } = props;
  useCloseOnOutsidePress(menu !== null, () => onMenu(null));
  const toggle = (name: MenuName) => onMenu(menu === name ? null : name);
  return (
    <div className={`${styles.bar} chrome`} {...{ [BAR_ATTRIBUTE]: '' }}>
      <SeekBar videoRef={videoRef} durationSec={durationSec} onSeek={actions.seekTo} />
      <div className={styles.buttons}>
        <RoundButton
          label={video.paused ? 'Play' : 'Pause'}
          icon={video.paused ? 'play' : 'pause'}
          onClick={actions.togglePlay}
        />
        <Skip label={`-${SKIP_BACK_SEC} s`} icon="skipBack" onClick={() => actions.skip(-SKIP_BACK_SEC)} />
        <Skip label={`+${SKIP_FORWARD_SEC} s`} icon="skipForward" onClick={() => actions.skip(SKIP_FORWARD_SEC)} />
        <TimeLabel videoRef={videoRef} durationSec={durationSec} />
        <div className={styles.volume}>
          <RoundButton
            label={video.muted || video.volume === 0 ? 'Unmute' : 'Mute'}
            icon={video.muted || video.volume === 0 ? 'mute' : 'volume'}
            onClick={actions.toggleMute}
          />
          <input
            type="range"
            className={styles.range}
            aria-label="Volume"
            min={0}
            max={1}
            step={0.01}
            value={video.muted ? 0 : video.volume}
            onChange={(event) => actions.setVolume(Number(event.currentTarget.value))}
          />
        </div>
        <span className={styles.spacer} />
        {props.audioItems.length > 0 ? (
          <div className={styles.menuRoot} data-menu-root>
            <RoundButton
              label="Audio"
              icon="audio"
              active={menu === 'audio'}
              expanded={menu === 'audio'}
              onClick={() => toggle('audio')}
            />
            {menu === 'audio' ? (
              <TrackMenu heading="Audio" items={props.audioItems} onClose={() => onMenu(null)} />
            ) : null}
          </div>
        ) : null}
        <div className={styles.menuRoot} data-menu-root>
          <RoundButton
            label="Subtitles"
            icon="subtitles"
            active={menu === 'subtitles'}
            expanded={menu === 'subtitles'}
            onClick={() => toggle('subtitles')}
          />
          {menu === 'subtitles' ? (
            <TrackMenu heading="Subtitles" items={props.subtitleItems} onClose={() => onMenu(null)} />
          ) : null}
        </div>
        <RoundButton label="Info" icon="info" active={infoOpen} pressed={infoOpen} onClick={onInfo} />
        {props.onPopOut ? (
          <RoundButton label="Mini player, stays on top (P)" icon="popOut" onClick={props.onPopOut} />
        ) : null}
        <RoundButton
          label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          icon={fullscreen ? 'fullscreenExit' : 'fullscreen'}
          onClick={actions.toggleFullscreen}
        />
      </div>
    </div>
  );
}
