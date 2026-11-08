import { useMediaQuery } from './useMediaQuery';

/** True while the user asked the system for less motion. */
export function useReducedMotion(): boolean {
  return useMediaQuery('(prefers-reduced-motion: reduce)');
}
