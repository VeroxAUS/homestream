import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { ExtractorLeadBound, type LeadReader } from '../../src/sourceproxy/leadBound.js';

const HOLD = 100;
const RESUME = 75;

const encoder = (owner: string | null = 's1'): LeadReader => ({ consumer: 'main', owner, runId: null });
const extractor = (owner: string | null = 's1', runId: number | null = 1): LeadReader => ({
  consumer: 'extractor',
  owner,
  runId,
});

describe('ExtractorLeadBound', () => {
  let released: Mock<() => void>;
  let bound: ExtractorLeadBound;

  beforeEach(() => {
    released = vi.fn<() => void>();
    bound = new ExtractorLeadBound(HOLD, RESUME, released);
  });

  it('holds an extractor once it is more than the hold distance past the encoder, not at exactly that distance', () => {
    const enc = encoder();
    const ext = extractor();
    bound.open(enc, 1000);
    bound.open(ext, 1000);
    bound.advance(ext, 1000 + HOLD);
    expect(bound.isHeld(ext)).toBe(false);
    bound.advance(ext, 1000 + HOLD + 1);
    expect(bound.isHeld(ext)).toBe(true);
  });

  it('releases with hysteresis: it stays held between the resume and hold distances', () => {
    const enc = encoder();
    const ext = extractor();
    bound.open(enc, 0);
    bound.open(ext, 0);
    bound.advance(ext, 150);
    expect(bound.isHeld(ext)).toBe(true);
    bound.advance(enc, 30);
    expect(bound.isHeld(ext)).toBe(true);
    bound.advance(enc, 40);
    expect(bound.isHeld(ext)).toBe(true);
    expect(released).not.toHaveBeenCalled();
    bound.advance(enc, 75);
    expect(bound.isHeld(ext)).toBe(false);
    expect(released).toHaveBeenCalledTimes(1);
    // It is held again only past the hold distance, not as soon as it is back above the resume distance.
    bound.advance(ext, 75 + RESUME + 10);
    expect(bound.isHeld(ext)).toBe(false);
    bound.advance(ext, 75 + HOLD + 1);
    expect(bound.isHeld(ext)).toBe(true);
  });

  it('never holds an extractor without an encoder reader, and frees a held one when the last encoder reader closes', () => {
    const ext = extractor();
    bound.open(ext, 0);
    bound.advance(ext, 10_000);
    expect(bound.isHeld(ext)).toBe(false);

    const enc = encoder();
    bound.open(enc, 0);
    expect(bound.isHeld(ext)).toBe(true);
    bound.close(enc);
    expect(bound.isHeld(ext)).toBe(false);
    expect(released).toHaveBeenCalledTimes(1);
  });

  it('does not hold an extractor that is behind the encoder or level with it', () => {
    const enc = encoder();
    const ext = extractor();
    bound.open(enc, 5000);
    bound.open(ext, 5000 - 12);
    bound.advance(ext, 5000);
    bound.advance(ext, 5000 + 50);
    expect(bound.isHeld(ext)).toBe(false);
  });

  it('measures from the main reader that moved last and falls back when it closes', () => {
    const cues = encoder();
    const video = encoder();
    const ext = extractor();
    bound.open(video, 0);
    bound.open(cues, 10_000);
    bound.open(ext, 500);
    // The reader that opened last is the front, wherever it is.
    expect(bound.isHeld(ext)).toBe(false);
    bound.advance(video, 100);
    expect(bound.isHeld(ext)).toBe(true);
    bound.advance(video, 450);
    expect(bound.isHeld(ext)).toBe(false);
    bound.advance(ext, 600);
    expect(bound.isHeld(ext)).toBe(true);
    bound.close(video);
    // The idle reader is all that is left: its position is the front.
    expect(bound.isHeld(ext)).toBe(false);
  });

  it('keeps sessions apart and ignores reads that cannot be attributed', () => {
    const encOne = encoder('s1');
    const extOne = extractor('s1');
    const extTwo = extractor('s2');
    const plain = extractor(null, null);
    const noRun = extractor('s1', null);
    bound.open(encOne, 0);
    for (const reader of [extOne, extTwo, plain, noRun]) {
      bound.open(reader, 0);
      bound.advance(reader, 10_000);
    }
    expect(bound.isHeld(extOne)).toBe(true);
    expect(bound.isHeld(extTwo)).toBe(false);
    expect(bound.isHeld(plain)).toBe(false);
    expect(bound.isHeld(noRun)).toBe(false);
    expect(bound.isHeld(encOne)).toBe(false);
  });

  it('forgets a session and wakes its held extractors', () => {
    const enc = encoder();
    const ext = extractor();
    bound.open(enc, 0);
    bound.open(ext, 0);
    bound.advance(ext, 1000);
    bound.forget('s1');
    expect(bound.isHeld(ext)).toBe(false);
    expect(released).toHaveBeenCalledTimes(1);
    bound.forget('s1');
    expect(released).toHaveBeenCalledTimes(1);
  });
});
