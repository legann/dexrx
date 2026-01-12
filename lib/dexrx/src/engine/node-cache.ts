import {
  CacheInvalidationStrategy,
  CacheStats,
  EngineCacheOptions,
  NodeCacheOptions,
  ICacheProvider,
} from '../types/cache-types';

/**
 * Cache entry
 */
interface CacheEntry<T = unknown> {
  /**
   * Cached data
   */
  value: T;

  /**
   * Expiration time (0 - never expires)
   */
  expiresAt: number;

  /**
   * Last access time
   */
  lastAccessed: number;

  /**
   * Hit counter for this entry (for LRU)
   */
  hits: number;
}

/**
 * Built-in cache implementation for nodes by default
 */
export class NodeCache implements ICacheProvider {
  /**
   * Global cache storage (nodeId -> inputsKey -> value)
   */
  private readonly cache: Map<string, Map<string, CacheEntry>> = new Map();

  /**
   * Cache options for individual nodes
   */
  private readonly nodeOptions: Map<string, NodeCacheOptions> = new Map();

  /**
   * Global cache options
   */
  private readonly globalOptions: EngineCacheOptions;

  /**
   * Cache statistics
   */
  private readonly stats: {
    hits: number;
    misses: number;
    nodeHits: Map<string, number>;
    nodeMisses: Map<string, number>;
  };

  /**
   * Constructor
   * @param options Global cache options
   */
  constructor(options: EngineCacheOptions = {}) {
    this.globalOptions = {
      enabled: options.enabled ?? true,
      maxEntries: options.maxEntries ?? 1000,
      defaultTtl: options.defaultTtl ?? 0,
      defaultInvalidationStrategy:
        options.defaultInvalidationStrategy ?? CacheInvalidationStrategy.INPUT_CHANGE,
      collectMetrics: options.collectMetrics ?? false,
    };

    this.stats = {
      hits: 0,
      misses: 0,
      nodeHits: new Map(),
      nodeMisses: new Map(),
    };
  }

  /**
   * Sets cache options for node
   * @param nodeId Node identifier
   * @param options Cache options
   */
  public setNodeOptions(nodeId: string, options: NodeCacheOptions): void {
    this.nodeOptions.set(nodeId, options);

    // Initialize cache for node if it doesn't exist yet
    if (!this.cache.has(nodeId)) {
      this.cache.set(nodeId, new Map());
    }
  }

  /**
   * Checks if caching is enabled for node
   * @param nodeId Node identifier
   * @returns Whether caching is enabled
   */
  public isCachingEnabled(nodeId: string): boolean {
    const nodeOptions = this.nodeOptions.get(nodeId);
    if (nodeOptions && typeof nodeOptions.enabled !== 'undefined') {
      return nodeOptions.enabled;
    }
    return this.globalOptions.enabled === true;
  }

  /**
   * Generates cache key for input data and configuration
   * @param nodeId Node identifier
   * @param inputs Input data
   * @param config Configuration
   * @returns Cache key
   */
  public generateCacheKey(nodeId: string, inputs: unknown[], config: unknown): string {
    const nodeOptions = this.nodeOptions.get(nodeId);

    // If node has its own key generator, use it
    if (nodeOptions?.keyGenerator) {
      return nodeOptions.keyGenerator(inputs, config);
    }

    // By default use JSON.stringify for input data
    try {
      // For configuration use hash only if CONFIG_CHANGE is specified in invalidation strategy
      const shouldIncludeConfig = this.shouldInvalidateOnConfigChange(nodeId);

      const cacheKey = shouldIncludeConfig
        ? JSON.stringify({ inputs, config })
        : JSON.stringify(inputs);

      return cacheKey;
    } catch (error) {
      // In case of serialization error (e.g., circular references)
      // generate unique key to avoid collisions
      return `${Date.now()}-${Math.random().toString(36).substring(2)}`;
    }
  }

  /**
   * Checks if cache should be invalidated on configuration change
   * @param nodeId Node identifier
   * @returns Whether to invalidate
   */
  private shouldInvalidateOnConfigChange(nodeId: string): boolean {
    const nodeOptions = this.nodeOptions.get(nodeId);
    if (!nodeOptions?.invalidationStrategy) {
      // Use global strategy
      const strategy = this.globalOptions.defaultInvalidationStrategy;

      // Check if invalidation on configuration change is enabled
      if (Array.isArray(strategy)) {
        return strategy.includes(CacheInvalidationStrategy.CONFIG_CHANGE);
      }
      return strategy === CacheInvalidationStrategy.CONFIG_CHANGE;
    }

    // Use node strategy
    const strategy = nodeOptions.invalidationStrategy;
    if (Array.isArray(strategy)) {
      return strategy.includes(CacheInvalidationStrategy.CONFIG_CHANGE);
    }
    return strategy === CacheInvalidationStrategy.CONFIG_CHANGE;
  }

  /**
   * Gets value from cache
   * @param nodeId Node identifier
   * @param cacheKey Cache key
   * @returns Cached value or undefined if not found
   */
  public get<T = unknown>(nodeId: string, cacheKey: string): T | undefined {
    if (!this.isCachingEnabled(nodeId)) {
      this.recordMiss(nodeId);
      return undefined;
    }

    const nodeCache = this.cache.get(nodeId);
    if (!nodeCache) {
      this.recordMiss(nodeId);
      return undefined;
    }

    const entry = nodeCache.get(cacheKey);
    if (!entry) {
      this.recordMiss(nodeId);
      return undefined;
    }

    // Check if entry has expired
    if (entry.expiresAt > 0 && entry.expiresAt < Date.now()) {
      // Time-to-live expired, remove entry
      nodeCache.delete(cacheKey);
      this.recordMiss(nodeId);
      return undefined;
    }

    // Update access statistics
    entry.lastAccessed = Date.now();
    entry.hits += 1;

    this.recordHit(nodeId);
    return entry.value as T;
  }

  /**
   * Sets value in cache
   * @param nodeId Node identifier
   * @param cacheKey Cache key
   * @param value Value to cache
   * @param ttl Time-to-live in milliseconds (optional)
   */
  public set<T = unknown>(nodeId: string, cacheKey: string, value: T, ttl?: number): void {
    if (!this.isCachingEnabled(nodeId)) {
      return;
    }

    // Get cache for node or create it
    let nodeCache = this.cache.get(nodeId);
    if (!nodeCache) {
      nodeCache = new Map();
      this.cache.set(nodeId, nodeCache);

      // Initialize cache options for node if they don't exist
      if (!this.nodeOptions.has(nodeId)) {
        this.nodeOptions.set(nodeId, {
          enabled: true,
        });
      }
    }

    // Determine TTL for entry (priority to passed value)
    const nodeTtl = this.getNodeTtl(nodeId);
    const actualTtl = ttl !== undefined ? ttl : nodeTtl;
    const expiresAt = actualTtl > 0 ? Date.now() + actualTtl : 0;

    // Create new entry
    const entry: CacheEntry<T> = {
      value,
      expiresAt,
      lastAccessed: Date.now(),
      hits: 0,
    };

    // Check if maximum cache size for node is exceeded
    const maxEntries = this.getNodeMaxEntries(nodeId);
    if (nodeCache.size >= maxEntries) {
      // Apply LRU (Least Recently Used) strategy:
      // remove entry that was accessed longest ago
      this.evictLRU(nodeCache);
    }

    // Check if global cache size limit is exceeded
    const globalMaxEntries = this.globalOptions.maxEntries ?? 1000;
    if (this.getTotalCacheSize() >= globalMaxEntries) {
      // Find and remove oldest entry from entire cache
      this.evictGlobalLRU();
    }

    // Save entry
    nodeCache.set(cacheKey, entry);
  }

  /**
   * Gets TTL for node
   * @param nodeId Node identifier
   * @returns TTL in milliseconds (0 - never expires)
   */
  private getNodeTtl(nodeId: string): number {
    const nodeOptions = this.nodeOptions.get(nodeId);
    if (nodeOptions && typeof nodeOptions.ttl !== 'undefined') {
      return nodeOptions.ttl;
    }
    return this.globalOptions.defaultTtl ?? 0;
  }

  /**
   * Gets maximum number of entries for node
   * @param nodeId Node identifier
   * @returns Maximum number of entries
   */
  private getNodeMaxEntries(nodeId: string): number {
    const nodeOptions = this.nodeOptions.get(nodeId);
    if (nodeOptions && typeof nodeOptions.maxEntries !== 'undefined') {
      return nodeOptions.maxEntries;
    }
    return this.globalOptions.maxEntries ?? 1000;
  }

  /**
   * Removes least recently used entry from cache
   * @param nodeCache Node cache
   */
  private evictLRU(nodeCache: Map<string, CacheEntry>): void {
    let lruKey: string | null = null;
    let lruTime = Infinity;
    let lruHits = Infinity;

    // Find entry with oldest access time
    // and if multiple entries have same time,
    // choose one with fewer accesses (hits)
    for (const [key, entry] of nodeCache.entries()) {
      // Prefer entries with fewer accesses at same time
      if (
        entry.lastAccessed < lruTime ||
        (entry.lastAccessed === lruTime && entry.hits < lruHits)
      ) {
        lruTime = entry.lastAccessed;
        lruHits = entry.hits;
        lruKey = key;
      }
    }

    // Remove found entry
    if (lruKey) {
      nodeCache.delete(lruKey);
    }
  }

  /**
   * Removes oldest entry from all node caches
   */
  private evictGlobalLRU(): void {
    let oldestNodeId: string | null = null;
    let oldestKey: string | null = null;
    let oldestAccessTime = Infinity;

    // Find oldest entry among all nodes
    for (const [nodeId, nodeCache] of this.cache.entries()) {
      for (const [key, entry] of nodeCache.entries()) {
        if (entry.lastAccessed < oldestAccessTime) {
          oldestAccessTime = entry.lastAccessed;
          oldestNodeId = nodeId;
          oldestKey = key;
        }
      }
    }

    // Remove found oldest entry
    if (oldestNodeId && oldestKey) {
      const nodeCache = this.cache.get(oldestNodeId);
      if (nodeCache) {
        nodeCache.delete(oldestKey);
      }
    }
  }

  /**
   * Invalidates cache for node
   * @param nodeId Node identifier
   * @param cacheKey Cache key (if not specified, all entries for node are invalidated)
   */
  public invalidate(nodeId: string, cacheKey?: string): void {
    const nodeCache = this.cache.get(nodeId);
    if (!nodeCache) return;

    if (cacheKey) {
      nodeCache.delete(cacheKey);
    } else {
      this.cache.delete(nodeId);
    }
  }

  /**
   * Invalidates entire cache
   */
  public invalidateAll(): void {
    this.cache.clear();
  }

  /**
   * Records cache hit
   * @param nodeId Node identifier
   */
  private recordHit(nodeId: string): void {
    if (!this.globalOptions.collectMetrics) {
      return;
    }

    this.stats.hits += 1;

    const currentHits = this.stats.nodeHits.get(nodeId) ?? 0;
    this.stats.nodeHits.set(nodeId, currentHits + 1);
  }

  /**
   * Records cache miss
   * @param nodeId Node identifier
   */
  private recordMiss(nodeId: string): void {
    if (!this.globalOptions.collectMetrics) {
      return;
    }

    this.stats.misses += 1;

    const currentMisses = this.stats.nodeMisses.get(nodeId) ?? 0;
    this.stats.nodeMisses.set(nodeId, currentMisses + 1);
  }

  /**
   * Gets cache usage statistics
   * @returns Cache statistics
   */
  public getStats(): CacheStats {
    const totalRequests = this.stats.hits + this.stats.misses;
    const hitRatio = totalRequests > 0 ? this.stats.hits / totalRequests : 0;

    const nodeStats: Record<string, { hits: number; misses: number; hitRatio: number }> = {};

    // Collect statistics for each node with cache
    if (this.globalOptions.collectMetrics) {
      for (const [nodeId] of this.cache.entries()) {
        const hits = this.stats.nodeHits.get(nodeId) ?? 0;
        const misses = this.stats.nodeMisses.get(nodeId) ?? 0;
        const nodeRequests = hits + misses;

        nodeStats[nodeId] = {
          hits,
          misses,
          hitRatio: nodeRequests > 0 ? hits / nodeRequests : 0,
        };
      }
    }

    return {
      hits: this.stats.hits,
      misses: this.stats.misses,
      hitRatio,
      size: this.getTotalCacheSize(),
      maxSize: this.getMaxCacheSize(),
      nodeStats: this.globalOptions.collectMetrics ? nodeStats : undefined,
    };
  }

  /**
   * Gets total cache size (number of entries)
   * @returns Cache size
   */
  private getTotalCacheSize(): number {
    let size = 0;
    for (const nodeCache of this.cache.values()) {
      size += nodeCache.size;
    }
    return size;
  }

  /**
   * Gets maximum cache size
   * @returns Maximum cache size
   */
  private getMaxCacheSize(): number {
    let maxSize = 0;
    for (const nodeId of this.cache.keys()) {
      maxSize += this.getNodeMaxEntries(nodeId);
    }
    return maxSize ?? this.globalOptions.maxEntries ?? 1000;
  }

  /**
   * Performs cache cleanup (removes expired entries)
   */
  public cleanup(): void {
    const now = Date.now();

    for (const nodeCache of this.cache.values()) {
      for (const [key, entry] of nodeCache.entries()) {
        if (entry.expiresAt > 0 && entry.expiresAt < now) {
          nodeCache.delete(key);
        }
      }
    }
  }
}
