/** The page performance mark that tells telemetry and the event stream that content is shown. */
export const HOME_CONTENT_MARK = 'hs:home-content';
const MARK_WAIT_LIMIT_MS = 8000;
const IDLE_TIMEOUT_MS = 3000;

/** Sets the mark once, after the next frame, so it reflects what the user can see. */
export function markContentShown(): void {
  requestAnimationFrame(() => {
    if (performance.getEntriesByName(HOME_CONTENT_MARK).length === 0) performance.mark(HOME_CONTENT_MARK);
  });
}

/** Resolves when the content mark exists, or after a limit so a page that never sets it cannot hold work back forever. */
export function afterHomeContent(): Promise<void> {
  return new Promise((resolve) => {
    if (performance.getEntriesByName(HOME_CONTENT_MARK).length > 0) return resolve();
    const done = (observer?: PerformanceObserver): void => {
      observer?.disconnect();
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => done(observer), MARK_WAIT_LIMIT_MS);
    const observer = new PerformanceObserver((list) => {
      if (list.getEntries().some((entry) => entry.name === HOME_CONTENT_MARK)) done(observer);
    });
    observer.observe({ type: 'mark' });
  });
}

export function whenIdle(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestIdleCallback === 'function') requestIdleCallback(() => resolve(), { timeout: IDLE_TIMEOUT_MS });
    else setTimeout(resolve, 0);
  });
}
