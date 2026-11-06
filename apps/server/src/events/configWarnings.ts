import type { Db } from '../db/index.js';
import type { EventBus } from './bus.js';
import { logEvent } from './record.js';

/** Keeps settings problems as `warn` events (queryable through the log view), next to the console line printed at start. */
export function recordConfigWarnings(deps: { db: Db; bus: EventBus }, warnings: readonly string[]): void {
  for (const message of warnings) logEvent(deps, { level: 'warn', source: 'server', message });
}
