import { useQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { infoQuery } from '../api/queries';
import { Badge } from '../components/Badge';
import { ErrorPanel } from '../components/ErrorPanel';
import { Toggle } from '../components/Toggle';
import { describePlaybackProfile, deviceKind, getDeviceName, registerDevice, setDeviceName } from '../device/identity';
import { setHideSpoilers, useHideSpoilers } from '../lib/spoilers';
import { useContentShown } from '../lib/useContentShown';
import { AboutDesktopRow, DesktopSettings } from '../desktop/DesktopSettings';
import { Row } from './SettingsRow';
import styles from './SettingsPage.module.css';

type SaveState = 'idle' | 'saved' | 'local-only';

function ThisDevice() {
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
          <Row label="Device name" help="Shown on the Activity and History dashboards.">
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
        <Row label="Device type">
          <Badge>{deviceKind() === 'desktop' ? 'Desktop app' : 'Web browser'}</Badge>
        </Row>
        <p className={styles.status} role="status">
          {state === 'saved' ? 'Device name saved.' : null}
          {state === 'local-only' ? 'Saved on this device. The server could not be reached to record it.' : null}
        </p>
      </div>
    </section>
  );
}

function About() {
  const { data, error, refetch } = useQuery(infoQuery());
  return (
    <section aria-labelledby="settings-about">
      <h2 id="settings-about" className={styles.section}>
        About
      </h2>
      {error ? (
        <ErrorPanel error={error} title="Server information unavailable" onRetry={() => void refetch()} />
      ) : null}
      {data ? (
        <div className={styles.card}>
          <AboutDesktopRow />
          <Row label="Server name">{data.name}</Row>
          <Row label="Version">
            <span className="tabular">{data.version}</span>
          </Row>
          <Row label="Server address">
            <span className="tabular">{window.location.origin}</span>
          </Row>
          <Row label="Port">
            <span className="tabular">{data.port}</span>
          </Row>
          <Row label="LAN addresses" help="Use one of these on a TV or phone.">
            {data.lanAddresses.length > 0 ? (
              <ul className={`${styles.addresses} tabular`}>
                {data.lanAddresses.map((address) => (
                  <li key={address}>{address}</li>
                ))}
              </ul>
            ) : (
              'None found'
            )}
          </Row>
          <Row label="Stream source">aiostreams (redacted)</Row>
          <Row label="Playback profile" help="What this browser asks the server to produce.">
            {describePlaybackProfile()}
          </Row>
        </div>
      ) : null}
      {!data && !error ? (
        <div
          className={`${styles.card} ${styles.loading} pulse`}
          role="status"
          aria-label="Loading server information"
        />
      ) : null}
    </section>
  );
}

export default function SettingsPage() {
  useContentShown();
  return (
    <main className={styles.page}>
      <h1 className={styles.title}>Settings</h1>
      <ThisDevice />
      <DesktopSettings />
      <About />
    </main>
  );
}
