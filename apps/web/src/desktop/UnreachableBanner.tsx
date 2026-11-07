import { useState } from 'react';
import { Icon } from '../components/Icon';
import { desktopBridge } from './bridge';
import styles from './UnreachableBanner.module.css';
import { useUnreachable } from './useUnreachable';

function Banner() {
  const unreachable = useUnreachable();
  const [message, setMessage] = useState('');
  const bridge = desktopBridge();
  if (!unreachable || !bridge) return null;
  const detail =
    unreachable.attempt === null
      ? 'The app is trying to reach it again.'
      : `The app is restarting it (attempt ${unreachable.attempt} of ${unreachable.limit}).`;
  const retry = () => {
    setMessage('');
    void bridge.restartServer().then((result) => setMessage(result.ok ? '' : (result.message ?? '')));
  };
  return (
    <div className={styles.banner} role="alert">
      <Icon name="unplug" size={22} className={styles.icon} />
      <div className={styles.text}>
        <span className={styles.title}>Can&apos;t reach the server</span>
        <span className={styles.detail}>
          {message || `${detail} Playback on other devices may pause for a moment.`}
        </span>
      </div>
      <span className={styles.spacer} />
      {unreachable.retryInSec !== null ? (
        <>
          <span className={styles.spinner} aria-hidden="true" />
          <span className={styles.countdown}>Retrying in {unreachable.retryInSec} s</span>
        </>
      ) : null}
      <button type="button" className={styles.button} onClick={retry}>
        Retry now
      </button>
      <button type="button" className={`${styles.button} ${styles.outline}`} onClick={() => void bridge.openLogs()}>
        Open logs
      </button>
    </div>
  );
}

/** A red banner under the nav while the desktop app's supervisor is bringing a crashed server back. */
export function UnreachableBanner() {
  return desktopBridge() ? <Banner /> : null;
}
