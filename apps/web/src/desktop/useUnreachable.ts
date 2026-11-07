import { parseServerStatus, restartDelaySec, SERVER_RESTART_LIMIT } from '@homestream/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { healthQuery } from '../api/queries';
import { useEventStreamLive } from '../events/serverEvents';
import { desktopBridge } from './bridge';

export interface Unreachable {
  attempt: number | null;
  limit: number;
  /** Seconds until the supervisor tries again, or 
ull when it is not waiting. */
  retryInSec: number | null;
}

const TICK_MS = 1000;

/**
 * Whether the server cannot be reached right now (the health request fails), and what the app's supervisor is doing
 * about it. The supervisor is asked once a second, but only while the server is unreachable.
 */
export function useUnreachable(): Unreachable | null {
  const queryClient = useQueryClient();
  const streamLive = useEventStreamLive();
  const { isError } = useQuery(healthQuery(!streamLive));
  const [status, setStatus] = useState<string>('');
  const [now, setNow] = useState(() => Date.now());
  const seen = useRef<{ attempt: number; at: number } | null>(null);

  useEffect(() => {
    const bridge = desktopBridge();
    if (!isError || !bridge) return;
    let active = true;
    const tick = () => {
      setNow(Date.now());
      void bridge.getServerStatus().then((text) => {
        if (!active) return;
        setStatus(text);
        if (parseServerStatus(text).kind === 'running') void queryClient.invalidateQueries({ queryKey: ['health'] });
      });
    };
    tick();
    const timer = window.setInterval(tick, TICK_MS);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [isError, queryClient]);

  if (!isError || !desktopBridge()) return null;
  const view = parseServerStatus(status);
  if (view.kind !== 'crashed') return { attempt: null, limit: SERVER_RESTART_LIMIT, retryInSec: null };
  if (seen.current?.attempt !== view.attempt) seen.current = { attempt: view.attempt, at: now };
  const elapsedSec = (now - seen.current.at) / 1000;
  const retryInSec = Math.max(0, Math.ceil(restartDelaySec(view.attempt) - elapsedSec));
  return { attempt: view.attempt, limit: view.limit, retryInSec };
}
