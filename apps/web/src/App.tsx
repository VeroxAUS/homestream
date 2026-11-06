import { useEffect, useState } from 'react';
import { ServerInfoSchema, type ServerInfo } from '@homestream/shared';
import { apiGet } from './api/client';
import { HOME_CONTENT_MARK } from './telemetry/index';
import { usePageView } from './telemetry/usePageView';

type InfoState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; info: ServerInfo };

export function App() {
  const [state, setState] = useState<InfoState>({ status: 'loading' });
  usePageView(window.location.pathname);

  useEffect(() => {
    const controller = new AbortController();
    apiGet('/api/info', ServerInfoSchema, controller.signal)
      .then((info) => setState({ status: 'ready', info }))
      .catch(() => {
        if (!controller.signal.aborted) setState({ status: 'error' });
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (state.status !== 'loading') performance.mark(HOME_CONTENT_MARK);
  }, [state.status]);

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem' }}>
      <h1>HomeStream</h1>
      <p>The web UI is coming soon.</p>
      <p role="status">
        {state.status === 'loading' && 'Connecting to the server...'}
        {state.status === 'error' && 'Server unreachable.'}
        {state.status === 'ready' && `Server: ${state.info.name} ${state.info.version}`}
      </p>
    </main>
  );
}
