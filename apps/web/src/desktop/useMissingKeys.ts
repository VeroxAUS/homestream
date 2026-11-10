import { useQuery } from '@tanstack/react-query';
import { healthQuery } from '../api/queries';
import { useEventStreamLive } from '../events/serverEvents';
import { desktopBridge } from './bridge';
import { configKeys, missingRequired, type ConfigKey } from './configKeys';

/** The keys list while the desktop app's server lacks a required key (the First run screen), otherwise `null`. */
export function useMissingKeys(): ConfigKey[] | null {
  const streamLive = useEventStreamLive();
  const isDesktop = desktopBridge() !== null;
  const { data } = useQuery({ ...healthQuery(!streamLive), enabled: isDesktop });
  // A disabled query still returns the answer the nav health pill cached under the same key.
  const keys = isDesktop ? configKeys(data) : null;
  return keys && missingRequired(keys).length > 0 ? keys : null;
}
