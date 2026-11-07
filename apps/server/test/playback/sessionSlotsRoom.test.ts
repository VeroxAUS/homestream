import { describe, expect, it } from 'vitest';
import { MAX_SESSIONS, SessionSlots, type SlotHost } from '../../src/playback/sessionSlots.js';

const slots = () => new SessionSlots({} as SlotHost, MAX_SESSIONS);
/** An encoder that outlived its stop holds a place without being a session. */
const drain = (target: SessionSlots) => {
  (target as unknown as { draining: number }).draining += 1;
};

describe('SessionSlots.ensureRoom', () => {
  it('passes while the start own reservation is within the limit', () => {
    const target = slots();
    target.reserve();
    target.reserve();
    expect(() => target.ensureRoom()).not.toThrow();
  });

  it('refuses a launch once a lingering encoder pushes the places above the limit', () => {
    const target = slots();
    target.reserve();
    drain(target);
    expect(() => target.ensureRoom()).not.toThrow();
    drain(target);
    expect(() => target.ensureRoom()).toThrowError(
      expect.objectContaining({ statusCode: 503, code: 'encoder_not_stopped' }),
    );
  });
});
