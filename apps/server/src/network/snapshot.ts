import type { NetworkDetails } from '@homestream/shared';
import type { PlaybackManager } from '../playback/manager.js';
import type { SourceProxy } from '../sourceproxy/proxy.js';

/** Live download figures (not cached): the total from the source proxy, one entry per live session from the playback manager. */
export function networkSnapshot(deps: { sourceProxy: Pick<SourceProxy, 'network'>; playback: Pick<PlaybackManager, 'networkSessions'> }): NetworkDetails {
  return { ...deps.sourceProxy.network(), sessions: deps.playback.networkSessions() };
}
