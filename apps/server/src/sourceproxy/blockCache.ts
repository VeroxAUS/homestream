export const BLOCK_SIZE = 1024 * 1024;
export const GLOBAL_CAP_BYTES = 1.5 * 1024 ** 3;
export const PER_SOURCE_CAP_BYTES = 768 * 1024 ** 2;
/** Blocks ending this far behind the playhead are the first to go; the encoder also re-reads a little before the playhead. */
export const KEEP_BEHIND_BYTES = 96 * 1024 ** 2;

export interface Block {
  owner: BlockOwner;
  index: number;
  data: Buffer;
}

export interface BlockOwner {
  /** Approximate byte position of the player; blocks well before it are evicted first. */
  playheadByte: number;
  readonly blocks: Map<number, Block>;
  blockBytes: number;
}

export interface BlockCacheStats {
  bytes: number;
  blocks: number;
  evictions: number;
}

/**
 * Read-through cache of fixed-size aligned blocks shared by all sources. One Map keeps recency order for the whole cache;
 * eviction takes the least recently used block that lies behind its source's playhead, else the least recently used overall.
 */
export class BlockCache {
  private readonly lru = new Map<Block, true>();
  private totalBytes = 0;
  private evictions = 0;

  constructor(
    private readonly capBytes = GLOBAL_CAP_BYTES,
    private readonly perSourceCapBytes = PER_SOURCE_CAP_BYTES,
  ) {}

  get(owner: BlockOwner, index: number): Buffer | undefined {
    const block = owner.blocks.get(index);
    if (!block) return undefined;
    this.lru.delete(block);
    this.lru.set(block, true);
    return block.data;
  }

  has(owner: BlockOwner, index: number): boolean {
    return owner.blocks.has(index);
  }

  put(owner: BlockOwner, index: number, data: Buffer): void {
    if (owner.blocks.has(index)) return;
    const block: Block = { owner, index, data };
    owner.blocks.set(index, block);
    owner.blockBytes += data.length;
    this.totalBytes += data.length;
    this.lru.set(block, true);
    while (owner.blockBytes > this.perSourceCapBytes) this.evictOne(owner);
    while (this.totalBytes > this.capBytes) this.evictOne(null);
  }

  drop(owner: BlockOwner): void {
    for (const block of owner.blocks.values()) {
      this.lru.delete(block);
      this.totalBytes -= block.data.length;
    }
    owner.blocks.clear();
    owner.blockBytes = 0;
  }

  stats(): BlockCacheStats {
    return { bytes: this.totalBytes, blocks: this.lru.size, evictions: this.evictions };
  }

  private evictOne(only: BlockOwner | null): void {
    let oldest: Block | null = null;
    let victim: Block | null = null;
    for (const block of this.lru.keys()) {
      if (only && block.owner !== only) continue;
      oldest ??= block;
      if ((block.index + 1) * BLOCK_SIZE <= block.owner.playheadByte - KEEP_BEHIND_BYTES) {
        victim = block;
        break;
      }
    }
    victim ??= oldest;
    if (!victim) return;
    this.lru.delete(victim);
    victim.owner.blocks.delete(victim.index);
    victim.owner.blockBytes -= victim.data.length;
    this.totalBytes -= victim.data.length;
    this.evictions += 1;
  }
}
