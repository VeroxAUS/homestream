import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { App } from './App';
import { createQueryClient, homeQuery } from './api/queries';
import { ErrorBoundary } from './components/ErrorBoundary';
import { registerDeviceWhenIdle } from './device/identity';
import { startServerEventsWhenIdle } from './events/serverEvents';
import { startTelemetryWhenIdle } from './telemetry';
import './styles/tokens.css';
import './styles/global.css';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

const queryClient = createQueryClient();
// The Home data request goes out while the Home code is still loading.
if (window.location.pathname === '/') void queryClient.prefetchQuery(homeQuery());
startTelemetryWhenIdle();
startServerEventsWhenIdle(queryClient);
registerDeviceWhenIdle();

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary name="app">
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
);
