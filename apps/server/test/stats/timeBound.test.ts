import { describe, expect, it } from 'vitest';
import { parseTimeBound } from '../../src/stats/timeBound.js';

describe('parseTimeBound', () => {
  it('reads epoch milliseconds', () => {
    expect(parseTimeBound('1762400000000', 'from')).toBe(1762400000000);
    expect(parseTimeBound('0', 'to')).toBe(0);
  });

  it('reads a local day: start for from, last millisecond for to', () => {
    expect(parseTimeBound('2026-11-06', 'from')).toBe(new Date(2026, 10, 6).getTime());
    expect(parseTimeBound('2026-11-06', 'to')).toBe(new Date(2026, 10, 7).getTime() - 1);
  });

  it('reads an ISO timestamp', () => {
    expect(parseTimeBound('2026-11-06T10:00:00Z', 'from')).toBe(Date.UTC(2026, 10, 6, 10));
  });

  it.each(['yesterday', '2026-13-40', '2026-02-30', '12ab', '-5'])('rejects %s', (raw) => {
    expect(parseTimeBound(raw, 'from')).toBeNull();
  });
});
