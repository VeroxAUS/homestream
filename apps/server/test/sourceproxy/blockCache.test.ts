import { describe, expect, it } from 'vitest';
import { BLOCK_SIZE, BlockCache, KEEP_BEHIND_BYTES, type BlockOwner } from '../../src/sourceproxy/blockCache.js';

const MB = BLOCK_SIZE;

function owner(playheadByte = 0): BlockOwner {
  return { playheadByte, blocks: new Map(), blockBytes: 0 };
}

const block = () => Buffer.alloc(MB);

describe('BlockCache', () => {
  it('stores and returns blocks and counts bytes', () => {
    const cache = new BlockCache(10 * MB, 10 * MB);
    const a = owner();
    cache.put(a, 3, block());
    expect(cache.has(a, 3)).toBe(true);
    expect(cache.get(a, 3)?.length).toBe(MB);
    expect(cache.get(a, 4)).toBeUndefined();
    expect(cache.stats()).toMatchObject({ bytes: MB, blocks: 1 });
  });

  it('evicts the least recently used block when over the global cap', () => {
    const cache = new BlockCache(3 * MB, 10 * MB);
    const a = owner();
    for (const index of [0, 1, 2]) cache.put(a, index, block());
    cache.get(a, 0);
    cache.put(a, 3, block());
    expect([0, 1, 2, 3].filter((index) => cache.has(a, index))).toEqual([0, 2, 3]);
    expect(cache.stats().bytes).toBe(3 * MB);
  });

  it('prefers blocks far behind the playhead over older blocks ahead of it', () => {
    const cache = new BlockCache(3 * MB, 10 * MB);
    const playhead = 500 * MB;
    const a = owner(playhead);
    const ahead = playhead / MB + 10;
    const behind = (playhead - KEEP_BEHIND_BYTES) / MB - 5;
    cache.put(a, ahead, block()); // oldest, but ahead of the playhead
    cache.put(a, behind, block());
    cache.put(a, ahead + 1, block());
    cache.put(a, ahead + 2, block());
    expect(cache.has(a, behind)).toBe(false);
    expect(cache.has(a, ahead)).toBe(true);
  });

  it('keeps recently read blocks just behind the playhead (the encoder re-reads a little before it)', () => {
    const cache = new BlockCache(2 * MB, 10 * MB);
    const playhead = 500 * MB;
    const a = owner(playhead);
    const near = playhead / MB - 2;
    cache.put(a, near, block());
    cache.put(a, near + 100, block());
    cache.put(a, near + 101, block());
    expect(cache.has(a, near)).toBe(false); // plain LRU applies when nothing is far behind
    expect(cache.has(a, near + 101)).toBe(true);
  });

  it('bounds each source separately and does not touch other sources', () => {
    const cache = new BlockCache(100 * MB, 2 * MB);
    const a = owner();
    const b = owner();
    cache.put(b, 0, block());
    for (const index of [0, 1, 2, 3]) cache.put(a, index, block());
    expect(a.blocks.size).toBe(2);
    expect(b.blocks.size).toBe(1);
  });

  it('drops everything of a source', () => {
    const cache = new BlockCache(10 * MB, 10 * MB);
    const a = owner();
    const b = owner();
    cache.put(a, 0, block());
    cache.put(a, 1, block());
    cache.put(b, 0, block());
    cache.drop(a);
    expect(cache.stats()).toMatchObject({ bytes: MB, blocks: 1 });
    expect(a.blockBytes).toBe(0);
    expect(cache.has(b, 0)).toBe(true);
  });
});
