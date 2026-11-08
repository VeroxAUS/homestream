import { useState, type FormEvent } from 'react';
import { Toggle } from '../../components/Toggle';
import { getDeviceName, registerDevice, setDeviceName } from '../../device/identity';
import { setHideSpoilers, useHideSpoilers } from '../../lib/spoilers';
import { Row } from '../SettingsRow';
import styles from '../SettingsPage.module.css';

type SaveState = 'idle' | 'saved' | 'local-only';

/** Settings > This device: the controls that belong to this browser or app only. */
export function DeviceCard() {
  const [name, setName] = useState(getDeviceName);
  const [state, setState] = useState<SaveState>('idle');
  const hideSpoilers = useHideSpoilers();

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setName(setDeviceName(name));
    setState((await registerDevice()) ? 'saved' : 'local-only');
  };

  return (
    <section aria-labelledby="settings-device">
      <h2 id="settings-device" className={styles.section}>
        This device
      </h2>
      <div className={styles.card}>
        <form onSubmit={(event) => void save(event)}>
          <Row label="Device name" help="Shown in the Activity and History dashboards">
            <input
              className={styles.input}
              type="text"
              value={name}
              maxLength={128}
              aria-label="Device name"
              onChange={(event) => {
                setName(event.target.value);
                setState('idle');
              }}
            />
            <button type="submit" className={styles.save}>
              Save
            </button>
          </Row>
        </form>
        <Row label="Hide episode spoilers" help="Blurs stills and hides descriptions of episodes you haven't finished">
          <Toggle label="Hide episode spoilers" checked={hideSpoilers} onChange={setHideSpoilers} />
        </Row>
        <p className={styles.status} role="status">
          {state === 'saved' ? 'Device name saved.' : null}
          {state === 'local-only' ? 'Saved on this device. The server could not be reached to record it.' : null}
        </p>
      </div>
    </section>
  );
}
