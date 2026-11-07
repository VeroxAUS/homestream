import { vi } from 'vitest';

type Handler = (event: string, data: unknown) => void;

/** A stand-in for hls.js: tests drive its events and read the subtitle track it was told to show. */
export class FakeHls {
  static instances: FakeHls[] = [];
  static isSupported = () => true;
  static Events = {
    SUBTITLE_TRACKS_UPDATED: 'hlsSubtitleTracksUpdated',
    MANIFEST_PARSED: 'hlsManifestParsed',
    ERROR: 'hlsError',
  };
  static ErrorTypes = { MEDIA_ERROR: 'mediaError', NETWORK_ERROR: 'networkError' };
  static ErrorDetails = { MANIFEST_LOAD_ERROR: 'manifestLoadError', LEVEL_LOAD_ERROR: 'levelLoadError' };

  handlers = new Map<string, Handler[]>();
  subtitleTracks = [
    { id: 0, name: 'Spanish [1]' },
    { id: 1, name: 'English [0]' },
  ];
  subtitleTrack = -1;
  subtitleDisplay = false;
  source: string | null = null;
  destroyed = false;
  recoverMediaError = vi.fn();

  constructor(readonly config: Record<string, unknown>) {
    FakeHls.instances.push(this);
  }

  on(event: string, handler: Handler) {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler]);
  }
  attachMedia() {}
  loadSource(url: string) {
    this.source = url;
  }
  destroy() {
    this.destroyed = true;
  }
  emit(event: string, data: unknown = {}) {
    for (const handler of this.handlers.get(event) ?? []) handler(event, data);
  }

  static get last(): FakeHls {
    const hls = FakeHls.instances.at(-1);
    if (!hls) throw new Error('hls.js was not created');
    return hls;
  }
}

export const hlsModule = { default: FakeHls };
