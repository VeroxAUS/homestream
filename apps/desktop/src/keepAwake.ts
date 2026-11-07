import type { PowerSaveMode } from '@homestream/shared';

/** `prevent-display-sleep` while this app's own player plays, `prevent-app-suspension` while anyone streams, else none. */
export function desiredBlocker(activeSessions: number, localPlaying: boolean): PowerSaveMode {
  if (localPlaying) return 'prevent-display-sleep';
  return activeSessions > 0 ? 'prevent-app-suspension' : 'none';
}

export interface PowerBlockerPort {
  start(type: 'prevent-app-suspension' | 'prevent-display-sleep'): number;
  stop(id: number): void;
}

/** Holds at most one power-save blocker and swaps it when the wanted mode changes. */
export class KeepAwake {
  private id: number | null = null;
  private current: PowerSaveMode = 'none';
  private sessions = 0;
  private playing = false;

  constructor(private readonly port: PowerBlockerPort) {}

  get mode(): PowerSaveMode {
    return this.current;
  }

  get activeSessions(): number {
    return this.sessions;
  }

  setSessions(count: number): void {
    this.sessions = count;
    this.apply();
  }

  setLocalPlaying(playing: boolean): void {
    this.playing = playing;
    this.apply();
  }

  /** Releases whatever is held (on quit). */
  release(): void {
    this.sessions = 0;
    this.playing = false;
    this.apply();
  }

  private apply(): void {
    const wanted = desiredBlocker(this.sessions, this.playing);
    if (wanted === this.current) return;
    if (this.id !== null) this.port.stop(this.id);
    this.id = wanted === 'none' ? null : this.port.start(wanted);
    this.current = wanted;
  }
}
