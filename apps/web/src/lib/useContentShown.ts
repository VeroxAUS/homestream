import { useEffect } from 'react';
import { markContentShown } from './startup';

/** A page calls this once what the user came for is on screen, so telemetry and the event stream can start. */
export function useContentShown(ready = true): void {
  useEffect(() => {
    if (ready) markContentShown();
  }, [ready]);
}
