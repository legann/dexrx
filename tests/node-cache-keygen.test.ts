import { NodeCache } from '../lib/dexrx/src/engine/node-cache';

describe('NodeCache.generateCacheKey', () => {
  it('is deterministic for the same non-serializable (circular/BigInt) inputs', () => {
    const cache = new NodeCache();
    const circular: Record<string, unknown> = { x: 1 };
    circular.self = circular;
    const k1 = cache.generateCacheKey('n', [circular, 10n], {});
    const k2 = cache.generateCacheKey('n', [circular, 10n], {});
    expect(k1).toBe(k2);
    // Not a `${Date.now()}-${Math.random()}` random fallback.
    expect(k1).not.toMatch(/^\d+-[a-z0-9]+$/);
  });
});
