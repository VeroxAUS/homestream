import type Hls from 'hls.js';
import { describe, expect, it, vi } from 'vitest';
import { applySubtitleSelection, hlsConfig } from './useHls';

type ShouldRetry = NonNullable<NonNullable<ReturnType<typeof hlsConfig>['fragLoadPolicy']>['default']['errorRetry']>;

function fragRetry() {
  const retry = hlsConfig(0).fragLoadPolicy?.default.errorRetry;
  if (!retry?.shouldRetry) throw new Error('fragment errors have no retry predicate');
  return { config: retry, shouldRetry: retry.shouldRetry as NonNullable<ShouldRetry['shouldRetry']> };
}

/** What hls.js passes: its own verdict (`retry`) is false for status 0 while the browser is online. */
function decide(code: number | undefined, retryCount: number, hlsVerdict: boolean): boolean {
  const { config, shouldRetry } = fragRetry();
  const response = code === undefined ? undefined : { url: 'https://example.test/seg.vtt', code };
  return shouldRetry(config, retryCount, false, response, hlsVerdict);
}

describe('fragment retry predicate', () => {
  it('retries status 0 (aborted or reset connections) although hls.js alone would give up', () => {
    expect(decide(0, 0, false)).toBe(true);
    expect(decide(0, 10, false)).toBe(true);
    expect(decide(0, 89, false)).toBe(true);
  });

  it('stops after the configured number of tries', () => {
    const { config } = fragRetry();
    expect(decide(0, config.maxNumRetry, false)).toBe(false);
    expect(decide(0, config.maxNumRetry + 1, false)).toBe(false);
  });

  it('keeps hls.js verdict for everything else: 503 retried, 4xx and parse errors not', () => {
    expect(decide(503, 3, true)).toBe(true);
    expect(decide(404, 0, false)).toBe(false);
    expect(decide(403, 0, false)).toBe(false);
    expect(decide(undefined, 0, false)).toBe(false);
    expect(decide(503, 90, false)).toBe(false);
  });
});

describe('applySubtitleSelection', () => {
  it('does not set the track again when it is already showing', () => {
    const set = vi.fn();
    const hls = {
      subtitleTracks: [{ id: 0, name: 'English [0]' }],
      get subtitleTrack() {
        return 0;
      },
      set subtitleTrack(value: number) {
        set(value);
      },
      subtitleDisplay: false,
    };
    applySubtitleSelection(hls as unknown as Hls, { index: 0, mode: 'sidecar' });
    expect(set).not.toHaveBeenCalled();
    expect(hls.subtitleDisplay).toBe(true);
  });
});
