import type { ICacheProvider, CacheStats } from '../interfaces/cache';

/**
 * In-memory cache provider implementation
 * Simple LRU-style cache with TTL support
 * @category Providers
 */
export class MemoryCacheProvider implements ICacheProvider {
  private readonly cache = new Map<string, { value: unknown; expires?: number }>();
  private readonly stats: CacheStats = {
    hits: 0,
    misses: 0,
    hitRatio: 0,
    size: 0,
    maxSize: this.maxSize ?? 0,
  };

  constructor(private readonly maxSize?: number) {}

  async get<T>(key: string): Promise<T | null> {
    const item = this.cache.get(key);

    if (!item) {
      this.stats.misses++;
      this.updateHitRatio();
      return null;
    }

    // Check expiration
    if (item.expires && item.expires < Date.now()) {
      this.cache.delete(key);
      this.stats.misses++;
      this.stats.size = this.cache.size;
      this.updateHitRatio();
      return null;
    }

    this.stats.hits++;
    this.updateHitRatio();
    return item.value as T;
  }

  async set<T>(key: string, value: T, ttl?: number): Promise<void> {
    // Check max size and evict if needed
    if (this.maxSize && this.cache.size >= this.maxSize && !this.cache.has(key)) {
      // Remove oldest entry (simple FIFO eviction)
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        this.cache.delete(firstKey);
      }
    }

    this.cache.set(key, {
      value,
      expires: ttl ? Date.now() + ttl * 1000 : undefined,
    });

    this.stats.size = this.cache.size;
  }

  async invalidate(key: string): Promise<void> {
    this.cache.delete(key);
    this.stats.size = this.cache.size;
  }

  async invalidateAll(): Promise<void> {
    this.cache.clear();
    this.stats.size = 0;
    this.stats.hits = 0;
    this.stats.misses = 0;
    this.stats.hitRatio = 0;
  }

  getStats(): CacheStats {
    return { ...this.stats };
  }

  private updateHitRatio(): void {
    const total = this.stats.hits + this.stats.misses;
    this.stats.hitRatio = total > 0 ? this.stats.hits / total : 0;
  }
}
