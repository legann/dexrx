/**
 * Cache provider interface for Build API
 * Simplified version of ICacheProvider for Build API usage
 * @category Providers
 */
export interface ICacheProvider {
  /**
   * Gets value from cache by key
   */
  get<T>(key: string): Promise<T | null>;

  /**
   * Saves value to cache with optional TTL
   */
  set<T>(key: string, value: T, ttl?: number): Promise<void>;

  /**
   * Invalidates (removes) value from cache
   */
  invalidate(key: string): Promise<void>;

  /**
   * Invalidates entire cache
   */
  invalidateAll(): Promise<void>;

  /**
   * Gets cache usage statistics
   */
  getStats(): CacheStats;
}

/**
 * Cache statistics
 */
export interface CacheStats {
  hits: number;
  misses: number;
  hitRatio: number;
  size: number;
  maxSize: number; // Required to match graph engine ICacheProvider
}
