import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { ServerInfo } from '@homestream/shared';
import { infoQuery } from '../../api/queries';
import { ErrorPanel } from '../../components/ErrorPanel';
import { Icon } from '../../components/Icon';
import { desktopBridge } from '../../desktop/bridge';
import { UpdateStatus } from '../../desktop/DesktopSettings';
import { describePlaybackProfile, deviceKind } from '../../device/identity';
import styles from './About.module.css';

function Line({ label, help, children }: { label: string; help?: string; children: ReactNode }) {
  return (
    <div className={styles.line}>
      <dt>
        <span>{label}</span>
        {help ? <small>{help}</small> : null}
      </dt>
      <dd className="tabular">{children}</dd>
    </div>
  );
}

function Group({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <div role="group" aria-labelledby={id}>
      <h3 id={id} className={styles.group}>
        {title}
      </h3>
      <dl>{children}</dl>
    </div>
  );
}

function Header() {
  const bridge = desktopBridge();
  return (
    <div className={styles.header}>
      <span className={styles.logo} aria-hidden="true">
        <Icon name="play" size={22} />
      </span>
      <div className={styles.name}>
        <h2>HomeStream</h2>
        <p>{bridge ? `Desktop app v${bridge.version} \u00b7 Electron 45` : 'Web app'}</p>
      </div>
      {bridge ? <UpdateStatus className={styles.update} /> : null}
    </div>
  );
}

function Summary({ info }: { info: ServerInfo }) {
  return (
    <div className={styles.summary}>
      <div data-column="1">
        <Group id="about-server" title="Server">
          <Line label="Server name">{info.name}</Line>
          <Line label="Version">{info.version}</Line>
          <Line label="Server address">{window.location.origin}</Line>
          <Line label="Port">{info.port}</Line>
        </Group>
      </div>
      <div data-column="2">
        <Group id="about-network" title="Network">
          <Line label="LAN addresses" help="Use one of these on a TV or phone">
            {info.lanAddresses.length > 0 ? (
              <ul className={styles.addresses}>
                {info.lanAddresses.map((address) => (
                  <li key={address}>{address}</li>
                ))}
              </ul>
            ) : (
              'None found'
            )}
          </Line>
        </Group>
        <Group id="about-playback" title="Playback">
          <Line label="Stream source">aiostreams (redacted)</Line>
          <Line label="Playback profile" help="What this browser asks the server to produce">
            {describePlaybackProfile()}
          </Line>
        </Group>
        <Group id="about-device" title="This device">
          <Line label="Device type">{deviceKind() === 'desktop' ? 'Desktop app' : 'Web browser'}</Line>
        </Group>
      </div>
    </div>
  );
}

/** Settings > About: read-only information, laid out as plain text rather than as setting cards. */
export function AboutPanel() {
  const { data, error, refetch } = useQuery(infoQuery());
  return (
    <>
      <Header />
      {error ? (
        <ErrorPanel error={error} title="Server information unavailable" onRetry={() => void refetch()} />
      ) : null}
      {data ? <Summary info={data} /> : null}
      {!data && !error ? (
        <div className={`${styles.loading} pulse`} role="status" aria-label="Loading server information" />
      ) : null}
    </>
  );
}
