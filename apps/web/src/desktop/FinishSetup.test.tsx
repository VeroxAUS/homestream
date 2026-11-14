import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installBridge } from '../test/desktopBridge';
import { mockApi, renderWithProviders } from '../test/render';
import { FinishSetup } from './FinishSetup';

const KEYS = [{ name: 'TMDB_READ_TOKEN', required: true, present: false }];

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));

afterEach(() => {
  delete window.homestream;
  vi.useRealTimers();
});

describe('FinishSetup Check again', () => {
  it('stops asking the server and drops its wait timer once the screen is gone', async () => {
    installBridge();
    mockApi({});
    const { unmount, queryClient } = renderWithProviders(<FinishSetup keys={KEYS} />);
    const refetch = vi.spyOn(queryClient, 'refetchQueries');
    await userEvent.click(screen.getByRole('button', { name: 'Check again' }), { delay: null });
    await act(() => vi.advanceTimersByTimeAsync(100));
    expect(refetch).toHaveBeenCalledTimes(1);
    const pending = vi.getTimerCount();

    unmount();
    expect(vi.getTimerCount()).toBeLessThan(pending);
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
