import { describe, expect, it } from 'vitest';
import { healthQuery } from './queries';

describe('healthQuery', () => {
  it('polls once a minute by default', () => {
    expect(healthQuery().refetchInterval).toBe(60_000);
  });

  it('does not poll while the event stream delivers health changes', () => {
    expect(healthQuery(false).refetchInterval).toBe(false);
  });
});
