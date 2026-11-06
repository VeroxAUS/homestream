import { describe, expect, it } from 'vitest';
import { ReadAheadWindow, leadSeconds } from '../../src/network/readAhead.js';

describe('ReadAheadWindow', () => {
  it('starts filling, waits at the limit and resumes only below the resume lead', () => {
    const window = new ReadAheadWindow(180, 120);
    expect(window.state).toBe('filling');
    expect(window.update(179.9)).toBe(false);
    expect(window.update(180)).toBe(true);
    expect(window.state).toBe('waiting');
    expect(window.update(200)).toBe(false);
    // Between the two points the state does not change either way.
    expect(window.update(150)).toBe(false);
    expect(window.waiting).toBe(true);
    expect(window.update(120)).toBe(false);
    expect(window.update(119.9)).toBe(true);
    expect(window.state).toBe('filling');
    expect(window.update(150)).toBe(false);
    expect(window.state).toBe('filling');
  });

  it('opens a fresh window on reset and says whether it was waiting', () => {
    const window = new ReadAheadWindow(180, 120);
    expect(window.reset()).toBe(false);
    window.update(181);
    expect(window.reset()).toBe(true);
    expect(window.state).toBe('filling');
  });
});

describe('leadSeconds', () => {
  it('counts the end of the last finished segment minus the player position', () => {
    expect(leadSeconds(44, 4, 0)).toBe(180);
    expect(leadSeconds(0, 4, 0)).toBe(4);
    expect(leadSeconds(100, 4, 250)).toBe(154);
  });
});
