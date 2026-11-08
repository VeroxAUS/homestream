import { useEffect, useState } from 'react';

/** The value after it has stopped changing for `delayMs`. Before the first pause it is `initial`. */
export function useDebouncedValue<T>(value: T, delayMs: number, initial: T = value): T {
  const [settled, setSettled] = useState(initial);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return settled;
}
