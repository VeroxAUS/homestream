import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { startTelemetryWhenIdle } from './telemetry';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

startTelemetryWhenIdle();

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
