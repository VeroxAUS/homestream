import { readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';

const SEGMENT_FILE = /^seg-(\d{1,7})\.(?:ts|m4s)$/;

/** Sizes of the finished segment files in one session directory. Finished segments never change, so each is stat-ed once. */
export class SegmentStore {
  readonly sizes = new Map<number, number>();
  private readonly names = new Map<number, string>();

  constructor(private readonly dir: string) {}

  async refresh(): Promise<void> {
    let listing: string[];
    try {
      listing = await readdir(this.dir);
    } catch {
      this.sizes.clear();
      this.names.clear();
      return;
    }
    const present = new Set<number>();
    await Promise.all(
      listing.map(async (name) => {
        const match = SEGMENT_FILE.exec(name);
        if (!match) return;
        const index = Number(match[1]);
        present.add(index);
        if (this.sizes.has(index)) return;
        try {
          this.sizes.set(index, (await stat(path.join(this.dir, name))).size);
          this.names.set(index, name);
        } catch {
          // deleted between readdir and stat
        }
      }),
    );
    for (const index of [...this.sizes.keys()]) {
      if (!present.has(index)) {
        this.sizes.delete(index);
        this.names.delete(index);
      }
    }
  }

  /** A new ffmpeg run rewrites segments from `fromIndex` on, so their cached sizes are stale. */
  forget(fromIndex: number): void {
    for (const index of [...this.sizes.keys()]) {
      if (index >= fromIndex) {
        this.sizes.delete(index);
        this.names.delete(index);
      }
    }
  }

  get totalBytes(): number {
    let total = 0;
    for (const size of this.sizes.values()) total += size;
    return total;
  }

  async remove(indices: number[]): Promise<void> {
    await Promise.all(
      indices.map(async (index) => {
        const name = this.names.get(index);
        if (!name) return;
        await rm(path.join(this.dir, name), { force: true, maxRetries: 3, retryDelay: 100 }).catch(() => undefined);
        this.sizes.delete(index);
        this.names.delete(index);
      }),
    );
  }
}
