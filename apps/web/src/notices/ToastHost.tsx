import { useEffect, useState } from 'react';
import { useMatch } from 'react-router';
import { Icon } from '../components/Icon';
import { dismissToast, useToast, type Toast } from './toastStore';
import styles from './ToastHost.module.css';

function useAutoDismiss(toast: Toast | null, held: boolean, paused: boolean): void {
  const id = toast?.id;
  const ms = toast?.autoDismissMs ?? null;
  useEffect(() => {
    if (id === undefined || ms === null || held || paused) return;
    const timer = window.setTimeout(() => dismissToast(id), ms);
    return () => window.clearTimeout(timer);
  }, [id, ms, held, paused]);
}

/** The one app-wide toast: bottom centre, never more than one, hovered or focused toasts stay up. */
export function ToastHost() {
  const toast = useToast();
  const inPlayer = useMatch('/play/*') !== null;
  const [paused, setPaused] = useState(false);
  const held = toast !== null && inPlayer && toast.deferWhilePlaying === true;
  useAutoDismiss(toast, held, paused);

  if (toast === null || held) return <div className={styles.live} role="status" aria-live="polite" />;
  const act = (onClick: () => void) => () => {
    dismissToast(toast.id);
    onClick();
  };
  return (
    <div className={styles.live} role="status" aria-live="polite">
      <div
        key={toast.id}
        className={`${styles.toast} ${toast.kind === 'error' ? styles.error : ''}`}
        data-kind={toast.kind}
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        onFocus={() => setPaused(true)}
        onBlur={() => setPaused(false)}
      >
        {toast.kind === 'error' ? <Icon name="warning" size={20} className={styles.icon} /> : null}
        <div className={styles.text}>
          <p className={styles.message}>{toast.message}</p>
          {toast.detail ? <p className={styles.detail}>{toast.detail}</p> : null}
        </div>
        {toast.actions.map((action, index) => (
          <button
            key={action.label}
            type="button"
            className={index === 0 ? styles.primary : styles.secondary}
            onClick={act(action.onClick)}
          >
            {action.label}
          </button>
        ))}
        <button type="button" className={styles.close} aria-label="Dismiss" onClick={() => dismissToast(toast.id)}>
          <Icon name="close" size={14} />
        </button>
      </div>
    </div>
  );
}
