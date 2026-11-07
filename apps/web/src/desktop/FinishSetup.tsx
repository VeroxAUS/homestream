import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Icon } from '../components/Icon';
import { desktopBridge } from './bridge';
import { configKeys, KEY_HELP, missingRequired, type ConfigKey } from './configKeys';
import styles from './FinishSetup.module.css';
import { healthQuery } from '../api/queries';

const WORDS = ['no', 'one', 'two', 'three', 'four'];
const CHECK_ATTEMPTS = 20;
const CHECK_WAIT_MS = 1000;

const wait = (ms: number): Promise<void> => new Promise((resolve) => window.setTimeout(resolve, ms));

function KeyRow({ item }: { item: ConfigKey }) {
  return (
    <div className={styles.key}>
      <div>
        <div className={styles.name}>{item.name}</div>
        <div className={styles.help}>{KEY_HELP[item.name] ?? ''}</div>
      </div>
      <span className={`${styles.badge} ${item.present ? styles.set : styles.missing}`}>
        {item.present ? <Icon name="check" size={12} /> : null}
        {item.present ? 'Set' : 'Missing'}
      </span>
    </div>
  );
}

/** Asks the server again after "Check again" until the keys are in, because the restarted server needs a moment. */
function useCheckAgain() {
  const queryClient = useQueryClient();
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState('');
  // Home replaces this screen as soon as the keys are in, which can happen while a check is still finishing.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const check = async (): Promise<void> => {
    const bridge = desktopBridge();
    if (!bridge) return;
    setChecking(true);
    setMessage('');
    try {
      const result = await bridge.restartServer();
      if (!result.ok && mounted.current) setMessage(result.message ?? '');
      for (let attempt = 0; attempt < CHECK_ATTEMPTS; attempt += 1) {
        await queryClient.refetchQueries({ queryKey: ['health'] });
        const keys = configKeys(queryClient.getQueryData(healthQuery().queryKey));
        if (keys && missingRequired(keys).length === 0) {
          await queryClient.invalidateQueries();
          return;
        }
        if (!result.ok) return;
        await wait(CHECK_WAIT_MS);
      }
    } finally {
      if (mounted.current) setChecking(false);
    }
  };
  return { checking, message, check };
}

/** Shown instead of Home inside the desktop app while the server lacks keys it needs. Values are never shown. */
export function FinishSetup({ keys }: { keys: ConfigKey[] }) {
  const navigate = useNavigate();
  const bridge = desktopBridge();
  const { checking, message, check } = useCheckAgain();
  const missing = missingRequired(keys).length;
  return (
    <main className={styles.page}>
      <h1 className={styles.title}>Finish setting up</h1>
      <p className={styles.lead}>
        HomeStream needs {WORDS[missing] ?? missing} more {missing === 1 ? 'key' : 'keys'} before it can show titles and
        start playback. The keys stay on this PC and the app never shows their values.
      </p>
      <div className={styles.card}>
        {keys.map((item) => (
          <KeyRow key={item.name} item={item} />
        ))}
      </div>
      <h2 className={styles.heading}>How to add them</h2>
      <ol className={styles.steps}>
        <li>
          Click <strong>Open config.env</strong>. It opens in Notepad. The file is{' '}
          <code>%APPDATA%\HomeStream\config.env</code>.
        </li>
        <li>
          Paste each key after its = sign, for example <code>TMDB_READ_TOKEN=paste-your-token-here</code>, then save the
          file.
        </li>
        <li>
          Click <strong>Check again</strong>. HomeStream restarts the server and checks the keys.
        </li>
      </ol>
      <div className={styles.actions}>
        <button type="button" className={styles.button} onClick={() => void bridge?.openConfig()}>
          Open config.env
        </button>
        <button type="button" className={styles.button} disabled={checking} onClick={() => void check()}>
          {checking ? 'Checking...' : 'Check again'}
        </button>
        <button
          type="button"
          className={`${styles.button} ${styles.outline}`}
          onClick={() => navigate('/dashboard/health')}
        >
          Open Health dashboard
        </button>
      </div>
      {message ? <p className={styles.note}>{message}</p> : null}
    </main>
  );
}
