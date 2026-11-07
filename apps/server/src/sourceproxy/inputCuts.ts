import type { ServerResponse } from 'node:http';

/**
 * Lets a session cut its encoder's reads at the proxy. An ffmpeg that is blocked on a read does not see `q`; with the
 * response torn down its read fails at once, and refusing the reads it retries (it reconnects by itself) keeps the
 * old encoder from pulling bytes again until the next encoder of the session starts.
 */
export class InputCuts {
  private readonly active = new Map<string, Set<ServerResponse>>();
  private readonly cut = new Set<string>();

  isCut(token: string): boolean {
    return this.cut.has(token);
  }

  track(token: string, res: ServerResponse): void {
    let responses = this.active.get(token);
    if (!responses) this.active.set(token, (responses = new Set()));
    const tracked = responses;
    tracked.add(res);
    res.once('close', () => {
      tracked.delete(res);
      if (tracked.size === 0 && this.active.get(token) === tracked) this.active.delete(token);
    });
  }

  cutOff(token: string): void {
    this.cut.add(token);
    for (const res of [...(this.active.get(token) ?? [])]) res.destroy();
  }

  reopen(token: string): void {
    this.cut.delete(token);
  }
}
