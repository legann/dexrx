import { MemoryCacheProvider } from '../lib/dexrx/src/providers/memory';

describe('MemoryCacheProvider — LRU eviction', () => {
  it('evicts the least-recently-used key, keeping a recently-read key', async () => {
    const cache = new MemoryCacheProvider(2);
    await cache.set('a', 1);
    await cache.set('b', 2);
    // Read 'a' so 'b' becomes the least-recently-used entry.
    expect(await cache.get('a')).toBe(1);
    // Insert 'c' at capacity -> LRU evicts 'b' (FIFO would have evicted 'a').
    await cache.set('c', 3);
    expect(await cache.get('b')).toBeNull();
    expect(await cache.get('a')).toBe(1);
    expect(await cache.get('c')).toBe(3);
  });
});
