import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { HOME_CONTENT_MARK } from './telemetry';

const track = vi.hoisted(() => vi.fn());
vi.mock('./telemetry/usePageView', () => ({ usePageView: track }));

const INFO = { app: 'homestream', name: 'Test PC', version: '1.2.3', port: 8600, lanAddresses: [] };

function answer(response: Response | Error): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(() => (response instanceof Error ? Promise.reject(response) : Promise.resolve(response)));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('App', () => {
  beforeEach(() => {
    performance.clearMarks();
    track.mockClear();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('shows the server it is connected to and marks the content as shown', async () => {
    const fetchMock = answer(Response.json(INFO));
    render(<App />);
    expect(screen.getByRole('heading', { name: 'HomeStream' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Connecting');
    expect(await screen.findByText('Server: Test PC 1.2.3')).toBeInTheDocument();
    const [path, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(path).toBe('/api/info');
    expect(new Headers(init.headers).get('X-Request-ID')).toBeTruthy();
    expect(performance.getEntriesByName(HOME_CONTENT_MARK)).toHaveLength(1);
    expect(track).toHaveBeenCalledWith('/');
  });

  it('says so when the server cannot be reached', async () => {
    answer(new TypeError('network down'));
    render(<App />);
    expect(await screen.findByText('Server unreachable.')).toBeInTheDocument();
  });

  it('says so when the server answers with an error', async () => {
    answer(Response.json({ error: { code: 'boom', message: 'Broken' } }, { status: 500 }));
    render(<App />);
    expect(await screen.findByText('Server unreachable.')).toBeInTheDocument();
  });
});
