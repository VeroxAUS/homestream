import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { attachLogSink, type LogEntry } from '../logger';
import { health } from '../test/fixtures';
import { mockApi, renderWithProviders } from '../test/render';
import { Layout } from './Layout';
import { ErrorBoundary } from './ErrorBoundary';

const telemetry = vi.hoisted(() => ({ reportRenderError: vi.fn() }));
vi.mock('../telemetry', async (importOriginal) => ({ ...(await importOriginal<object>()), ...telemetry }));
vi.mock('../pages/searchRoute', () => ({ loadSearchPage: vi.fn() }));

function Boom({ message = 'boom' }: { message?: string }): never {
  throw new Error(message);
}

const reload = vi.fn();
const originalLocation = window.location;

beforeEach(() => {
  attachLogSink(() => undefined);
  telemetry.reportRenderError.mockClear();
  reload.mockClear();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  Object.defineProperty(window, 'location', { configurable: true, value: { ...originalLocation, reload } });
});
afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
});

describe('ErrorBoundary', () => {
  it('renders its children when nothing fails', () => {
    render(
      <ErrorBoundary name="app">
        <p>fine</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText('fine')).toBeInTheDocument();
    expect(telemetry.reportRenderError).not.toHaveBeenCalled();
  });

  it('shows the card when a child throws, with Reload and Open Health', () => {
    render(
      <ErrorBoundary name="app">
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong');
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Health' })).toHaveAttribute('href', '/dashboard/health');
  });

  it('Reload reloads the page', async () => {
    render(
      <ErrorBoundary name="app">
        <Boom />
      </ErrorBoundary>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('reports the error once, with the boundary name, and never shows its message', () => {
    render(
      <ErrorBoundary name="app">
        <Boom message="secret-user-text" />
      </ErrorBoundary>,
    );
    expect(telemetry.reportRenderError).toHaveBeenCalledTimes(1);
    expect(telemetry.reportRenderError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'secret-user-text' }),
      'app',
    );
    expect(screen.queryByText(/secret-user-text/)).not.toBeInTheDocument();
  });

  it('does not report again when it re-renders with the card showing', () => {
    const { rerender } = render(
      <ErrorBoundary name="app">
        <Boom />
      </ErrorBoundary>,
    );
    rerender(
      <ErrorBoundary name="app">
        <Boom />
      </ErrorBoundary>,
    );
    expect(telemetry.reportRenderError).toHaveBeenCalledTimes(1);
  });

  it('logs through the logger without the error message', () => {
    const entries: LogEntry[] = [];
    const detach = attachLogSink((entry) => entries.push(entry));
    render(
      <ErrorBoundary name="route">
        <Boom message="secret-user-text" />
      </ErrorBoundary>,
    );
    detach();
    expect(entries).toEqual([
      { level: 'error', category: 'app', message: 'render error', data: { boundary: 'route', error: 'Error' } },
    ]);
  });

  it('tries its children again when the reset key changes', () => {
    function Harness() {
      const [key, setKey] = useState('a');
      const [broken, setBroken] = useState(true);
      return (
        <>
          <button
            type="button"
            onClick={() => {
              setBroken(false);
              setKey('b');
            }}
          >
            go
          </button>
          <ErrorBoundary name="route" resetKey={key}>
            {broken ? <Boom /> : <p>recovered</p>}
          </ErrorBoundary>
        </>
      );
    }
    render(<Harness />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    screen.getByRole('button', { name: 'go' }).click();
    return screen.findByText('recovered');
  });
});

describe('the route boundary in the layout', () => {
  it('keeps the navigation, shows the card for a failing page and recovers on the next route', async () => {
    mockApi({ 'GET /api/health': health('ok', ['ok']) });
    renderWithProviders(
      <Routes>
        <Route element={<Layout />}>
          <Route path="broken" element={<Boom />} />
          <Route path="search" element={<p>search page</p>} />
        </Route>
      </Routes>,
      '/broken',
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong');
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument();
    expect(telemetry.reportRenderError).toHaveBeenCalledTimes(1);
    expect(telemetry.reportRenderError).toHaveBeenCalledWith(expect.any(Error), 'route');
    await userEvent.type(screen.getByRole('textbox', { name: 'Search movies and shows' }), 'x');
    expect(await screen.findByText('search page')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
