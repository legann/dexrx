export interface CacheStats {
  hits: number;
  misses: number;
  hitRatio: number;
  size: number;
  maxSize: number;
  nodeStats?: Record<string, { hits: number; misses: number; hitRatio: number }>;
}

/**
 * Cache invalidation strategy
 */
export enum CacheInvalidationStrategy {
  /**
   * By time-to-live (TTL)
   */
  TIME = 'time',

  /**
   * On node configuration change
   */
  CONFIG_CHANGE = 'config_change',

  /**
   * On any input data change
   */
  INPUT_CHANGE = 'input_change',

  /**
   * Only on manual invalidation
   */
  MANUAL = 'manual',
}

/**
 * Cache provider interface
 * Used for inversion of control and providing custom cache implementations
 */
export interface ICacheProvider {
  /**
   * Gets value from cache by key
   * @param nodeId Node identifier
   * @param cacheKey Cache key
   * @returns Cached value or undefined if value not found
   */
  get<T = unknown>(nodeId: string, cacheKey: string): T | undefined;

  /**
   * Saves value to cache
   * @param nodeId Node identifier
   * @param cacheKey Cache key
   * @param value Value to save
   * @param ttl Time-to-live for entry in milliseconds (optional)
   */
  set<T = unknown>(nodeId: string, cacheKey: string, value: T, ttl?: number): void;

  /**
   * Invalidates (removes) value from cache
   * @param nodeId Node identifier
   * @param cacheKey Cache key (if not specified, all entries for node are invalidated)
   */
  invalidate(nodeId: string, cacheKey?: string): void;

  /**
   * Invalidates entire cache
   */
  invalidateAll(): void;

  /**
   * Generates cache key for input data and configuration
   * @param nodeId Node identifier
   * @param inputs Input data
   * @param config Configuration
   * @returns Cache key
   */
  generateCacheKey(nodeId: string, inputs: readonly unknown[], config: unknown): string;

  /**
   * Gets cache usage statistics
   */
  getStats(): CacheStats;

  /**
   * Cleans up stale entries
   */
  cleanup(): void;

  /**
   * Sets cache options for node
   * @param nodeId Node identifier
   * @param options Cache options
   */
  setNodeOptions(nodeId: string, options: NodeCacheOptions): void;

  /**
   * Checks if caching is enabled for node
   * @param nodeId Node identifier
   * @returns Whether caching is enabled
   */
  isCachingEnabled(nodeId: string): boolean;

  /**
   * Exports node cache to serializable format
   * @param nodeId Node identifier
   * @returns Array of serialized cache entries or undefined if cache is empty
   */
  exportNodeCache?(nodeId: string): SerializedCacheEntry[] | undefined;

  /**
   * Imports node cache from serializable format
   * @param nodeId Node identifier
   * @param entries Array of serialized cache entries
   * @returns Promise that resolves when cache is imported
   */
  importNodeCache?(nodeId: string, entries: SerializedCacheEntry[]): Promise<void>;
}

/**
 * Caching options for node
 */
export interface NodeCacheOptions {
  /**
   * Whether caching is enabled for node
   */
  enabled?: boolean;

  /**
   * Maximum number of cached entries for node
   * If not specified, global value is used
   */
  maxEntries?: number;

  /**
   * Cache time-to-live in milliseconds
   * Default - infinity (0)
   */
  ttl?: number;

  /**
   * Cache invalidation strategy
   * Default - on input data change
   */
  invalidationStrategy?: CacheInvalidationStrategy | CacheInvalidationStrategy[];

  /**
   * Function for generating cache key
   * Default uses JSON.stringify of input data
   */
  keyGenerator?: (inputs: readonly unknown[], config: unknown) => string;
}

/**
 * Global caching options for engine
 */
export interface EngineCacheOptions {
  /**
   * Whether caching is enabled globally
   * Default - true
   */
  enabled?: boolean;

  /**
   * Maximum number of entries in engine cache
   * Default - 1000
   */
  maxEntries?: number;

  /**
   * Default cache time-to-live in milliseconds
   * Default - infinity (0)
   */
  defaultTtl?: number;

  /**
   * Default cache invalidation strategy
   * Default - on input data change
   */
  defaultInvalidationStrategy?: CacheInvalidationStrategy | CacheInvalidationStrategy[];

  /**
   * Collect cache metrics (hits/misses)
   * Default - false
   */
  collectMetrics?: boolean;

  /**
   * Custom cache provider for inversion of control
   * If specified, used instead of built-in cache
   */
  provider?: ICacheProvider;
}

export interface SerializedCacheEntry {
  readonly key: string;
  readonly value: unknown;
  readonly timestamp: number;
  readonly ttl?: number;
}
