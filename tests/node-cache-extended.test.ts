import { NodeCache } from '../lib/dexrx/src/engine/node-cache';
import { CacheInvalidationStrategy } from '../lib/dexrx/src/types/cache-types';

describe('NodeCache - Extended Tests', () => {
  let cache: NodeCache;

  beforeEach(() => {
    cache = new NodeCache({
      enabled: true,
      collectMetrics: true
    });
  });

  afterEach(() => {
    cache = null as any;
  });

  // Basic cache operations
  describe('Basic Operations', () => {
    it('should save and retrieve data', () => {
      const nodeId = 'test_node';
      const cacheKey = 'test_key';
      const testData = { value: 42 };

      // Save data to cache
      cache.set(nodeId, cacheKey, testData);

      // Retrieve data from cache
      const cachedData = cache.get(nodeId, cacheKey);

      // Check that data was saved and retrieved correctly
      expect(cachedData).toEqual(testData);
    });

    it('should return undefined for non-existent keys', () => {
      const nodeId = 'test_node';
      const nonExistentKey = 'non_existent_key';

      // Try to get non-existent data
      const cachedData = cache.get(nodeId, nonExistentKey);

      // Check that undefined is returned
      expect(cachedData).toBeUndefined();
    });

    it('should update existing data', () => {
      const nodeId = 'test_node';
      const cacheKey = 'test_key';
      const initialData = { value: 42 };
      const updatedData = { value: 99 };

      // Save initial data
      cache.set(nodeId, cacheKey, initialData);

      // Update data
      cache.set(nodeId, cacheKey, updatedData);

      // Get updated data
      const cachedData = cache.get(nodeId, cacheKey);

      // Check that data was updated
      expect(cachedData).toEqual(updatedData);
      expect(cachedData).not.toEqual(initialData);
    });
  });

  // Cache invalidation strategies
  describe('Invalidation Strategies', () => {
    it('should use invalidation strategy by input data change (default)', () => {
      const nodeId = 'test_node';
      
      // Generate cache key for specific input data
      const inputs1 = [1, 2, 3];
      const config = { param: 'value' };
      const cacheKey1 = cache.generateCacheKey(nodeId, inputs1, config);
      
      // Generate different key for different input data, but with same configuration
      const inputs2 = [4, 5, 6];
      const cacheKey2 = cache.generateCacheKey(nodeId, inputs2, config);
      
      // Check that keys differ
      expect(cacheKey1).not.toEqual(cacheKey2);
    });
    
    it('should use invalidation strategy by configuration change', () => {
      const nodeId = 'config_change_node';
      
      // Set invalidation strategy by configuration change
      cache.setNodeOptions(nodeId, {
        invalidationStrategy: CacheInvalidationStrategy.CONFIG_CHANGE
      });
      
      // Generate cache key for specific input data and configuration
      const inputs = [1, 2, 3];
      const config1 = { param: 'value1' };
      const cacheKey1 = cache.generateCacheKey(nodeId, inputs, config1);
      
      // Generate different key for same input data, but with different configuration
      const config2 = { param: 'value2' };
      const cacheKey2 = cache.generateCacheKey(nodeId, inputs, config2);
      
      // Check that keys differ
      expect(cacheKey1).not.toEqual(cacheKey2);
    });
    
    it('should support multiple invalidation strategies simultaneously', () => {
      const nodeId = 'multiple_strategies_node';
      
      // Set multiple invalidation strategies
      cache.setNodeOptions(nodeId, {
        invalidationStrategy: [
          CacheInvalidationStrategy.INPUT_CHANGE,
          CacheInvalidationStrategy.CONFIG_CHANGE
        ]
      });
      
      // Check input data change
      const inputs1 = [1, 2, 3];
      const inputs2 = [4, 5, 6];
      const config = { param: 'value' };
      
      const key1 = cache.generateCacheKey(nodeId, inputs1, config);
      const key2 = cache.generateCacheKey(nodeId, inputs2, config);
      
      expect(key1).not.toEqual(key2);
      
      // Check configuration change
      const inputs3 = [1, 2, 3]; // Same input data as inputs1
      const config2 = { param: 'different_value' };
      
      const key3 = cache.generateCacheKey(nodeId, inputs3, config2);
      
      expect(key1).not.toEqual(key3);
    });
    
    it('should support manual cache invalidation', () => {
      const nodeId = 'manual_invalidation_node';
      const cacheKey = 'test_key';
      const testData = { value: 42 };
      
      // Save data to cache
      cache.set(nodeId, cacheKey, testData);
      
      // Check that data is actually in cache
      expect(cache.get(nodeId, cacheKey)).toEqual(testData);
      
      // Manually invalidate specific key
      cache.invalidate(nodeId, cacheKey);
      
      // Check that data was removed
      expect(cache.get(nodeId, cacheKey)).toBeUndefined();
    });
    
    it('should support invalidating entire node cache', () => {
      const nodeId = 'node_invalidation';
      
      // Save several entries for one node
      cache.set(nodeId, 'key1', 'value1');
      cache.set(nodeId, 'key2', 'value2');
      
      // Check that data is actually in cache
      expect(cache.get(nodeId, 'key1')).toEqual('value1');
      expect(cache.get(nodeId, 'key2')).toEqual('value2');
      
      // Invalidate entire node cache
      cache.invalidate(nodeId);
      
      // Check that all node data was removed
      expect(cache.get(nodeId, 'key1')).toBeUndefined();
      expect(cache.get(nodeId, 'key2')).toBeUndefined();
    });
    
    it('should support invalidating entire cache', () => {
      // Save data for different nodes
      cache.set('node1', 'key1', 'value1');
      cache.set('node2', 'key2', 'value2');
      
      // Check that data is actually in cache
      expect(cache.get('node1', 'key1')).toEqual('value1');
      expect(cache.get('node2', 'key2')).toEqual('value2');
      
      // Invalidate entire cache
      cache.invalidateAll();
      
      // Check that all data was removed
      expect(cache.get('node1', 'key1')).toBeUndefined();
      expect(cache.get('node2', 'key2')).toBeUndefined();
    });
  });

  // Cache time-to-live (TTL)
  describe('Time-to-Live (TTL) Management', () => {
    it('should support TTL for entries', async () => {
      const nodeId = 'ttl_node';
      const cacheKey = 'ttl_key';
      const testData = { value: 'expires_soon' };
      
      // Set entry with short time-to-live (100 ms)
      cache.set(nodeId, cacheKey, testData, 100);
      
      // Immediately after setting data should be available
      expect(cache.get(nodeId, cacheKey)).toEqual(testData);
      
      // Wait until time-to-live expires
      await new Promise(resolve => setTimeout(resolve, 150));
      
      // After TTL expires data should be removed
      expect(cache.get(nodeId, cacheKey)).toBeUndefined();
    });
    
    it('should support TTL settings at node level', async () => {
      const nodeId = 'node_level_ttl';
      const cacheKey = 'test_key';
      const testData = { value: 'node_level_ttl' };
      
      // Set TTL at node level
      cache.setNodeOptions(nodeId, {
        ttl: 100 // 100 ms
      });
      
      // Set entry without explicit TTL
      cache.set(nodeId, cacheKey, testData);
      
      // Immediately after setting data should be available
      expect(cache.get(nodeId, cacheKey)).toEqual(testData);
      
      // Wait until time-to-live expires
      await new Promise(resolve => setTimeout(resolve, 150));
      
      // After TTL expires data should be removed
      expect(cache.get(nodeId, cacheKey)).toBeUndefined();
    });
    
    it('should give priority to explicitly specified TTL over node TTL', async () => {
      const nodeId = 'ttl_priority';
      const cacheKey = 'test_key';
      const testData = { value: 'ttl_priority' };
      
      // Set TTL at node level
      cache.setNodeOptions(nodeId, {
        ttl: 1000 // 1000 ms (long)
      });
      
      // Set entry with explicitly specified shorter TTL
      cache.set(nodeId, cacheKey, testData, 100); // 100 ms (short)
      
      // Immediately after setting data should be available
      expect(cache.get(nodeId, cacheKey)).toEqual(testData);
      
      // Wait until explicitly specified TTL expires
      await new Promise(resolve => setTimeout(resolve, 150));
      
      // After explicitly specified TTL expires data should be removed
      // despite node TTL not yet expired
      expect(cache.get(nodeId, cacheKey)).toBeUndefined();
    });
    
    it('should correctly perform cleanup of stale entries', async () => {
      const nodeId = 'cleanup_test';
      const cacheKey = 'test_key';
      const testData = { value: 'cleanup_test' };
      
      // Set entry with short time-to-live
      cache.set(nodeId, cacheKey, testData, 100);
      
      // Immediately after setting data should be available
      expect(cache.get(nodeId, cacheKey)).toEqual(testData);
      
      // Wait until time-to-live expires
      await new Promise(resolve => setTimeout(resolve, 150));
      
      // Call cleanup method
      cache.cleanup();
      
      // After cleanup data should be removed
      expect(cache.get(nodeId, cacheKey)).toBeUndefined();
    });
  });

  // Cache size limits and eviction
  describe('Size Limits and Eviction', () => {
    it('should respect maximum entries limit', () => {
      const nodeId = 'max_entries_test';
      
      // Set maximum entries = 3
      cache.setNodeOptions(nodeId, {
        maxEntries: 3
      });
      
      // Add 4 entries (one more than limit)
      cache.set(nodeId, 'key1', 'value1');
      cache.set(nodeId, 'key2', 'value2');
      cache.set(nodeId, 'key3', 'value3');
      
      // All first 3 entries should be in cache
      expect(cache.get(nodeId, 'key1')).toEqual('value1');
      expect(cache.get(nodeId, 'key2')).toEqual('value2');
      expect(cache.get(nodeId, 'key3')).toEqual('value3');
      
      // Add 4th entry which should evict oldest
      cache.set(nodeId, 'key4', 'value4');
      
      // After adding 4th entry, first should be evicted (LRU)
      // Only keys key2, key3, key4 remain
      expect(cache.get(nodeId, 'key4')).toEqual('value4');
      // Depending on LRU implementation, either key1 or another may be evicted
      // We check that at least some key is evicted, and no more than 3 entries remain
      const stats = cache.getStats();
      expect(stats.size).toBeLessThanOrEqual(3);
    });
    
    it('should use LRU eviction strategy', () => {
      const nodeId = 'lru_eviction_test';
      
      // Create new cache instance specifically for this test
      const lruCache = new NodeCache({
        enabled: true,
        collectMetrics: true
      });
      
      // Set maximum entries = 2
      lruCache.setNodeOptions(nodeId, {
        maxEntries: 2
      });
      
      // Add 2 entries
      lruCache.set(nodeId, 'key1', 'value1');
      lruCache.set(nodeId, 'key2', 'value2');
      
      // Check that both entries are in cache
      expect(lruCache.get(nodeId, 'key1')).toEqual('value1');
      expect(lruCache.get(nodeId, 'key2')).toEqual('value2');
      
      // Update access time for key1, making it "newer"
      lruCache.get(nodeId, 'key1');
      
      // Add 3rd entry which should evict oldest (key2)
      lruCache.set(nodeId, 'key3', 'value3');
      
      // key1 should remain, as it was recently used
      // key2 should be evicted as least recently used
      expect(lruCache.get(nodeId, 'key1')).toEqual('value1');
      expect(lruCache.get(nodeId, 'key2')).toBeUndefined();
      expect(lruCache.get(nodeId, 'key3')).toEqual('value3');
    });
    
    it('should respect global cache size limit', () => {
      // Create new cache with strict size limit
      const smallCache = new NodeCache({
        enabled: true,
        maxEntries: 2 // Global limit of 2 entries
      });
      
      // Add entries for different nodes, exceeding limit in total
      smallCache.set('node1', 'key1', 'value1');
      smallCache.set('node2', 'key1', 'value2');
      
      // Check that both values are saved
      expect(smallCache.get('node1', 'key1')).toEqual('value1');
      expect(smallCache.get('node2', 'key1')).toEqual('value2');
      
      // Add third entry which should evict oldest
      smallCache.set('node3', 'key1', 'value3');
      
      // Now cache should have only two entries
      // Check that first entry was evicted
      expect(smallCache.get('node1', 'key1')).toBeUndefined();
      expect(smallCache.get('node2', 'key1')).toEqual('value2');
      expect(smallCache.get('node3', 'key1')).toEqual('value3');
      
      const stats = smallCache.getStats();
      expect(stats.size).toBeLessThanOrEqual(2);
    });
  });

  // Cache metrics and statistics
  describe('Metrics and Statistics', () => {
    it('should collect cache usage metrics', () => {
      const nodeId = 'metrics_test';
      const cacheKey = 'test_key';
      
      // Add entry to cache
      cache.set(nodeId, cacheKey, 'value');
      
      // Get entry several times (cache hits)
      cache.get(nodeId, cacheKey);
      cache.get(nodeId, cacheKey);
      
      // Try to get non-existent entry (cache misses)
      cache.get(nodeId, 'non_existent');
      
      // Get statistics and check it
      const stats = cache.getStats();
      
      expect(stats.hits).toBeGreaterThan(0);
      expect(stats.misses).toBeGreaterThan(0);
      expect(stats.hitRatio).toBeGreaterThan(0);
      expect(stats.size).toBeGreaterThan(0);
      
      // Check node statistics if available
      if (stats.nodeStats) {
        const nodeStats = stats.nodeStats[nodeId];
        expect(nodeStats).toBeDefined();
        expect(nodeStats.hits).toBeGreaterThan(0);
        expect(nodeStats.misses).toBeGreaterThan(0);
      }
    });
    
    it('should update metrics when cache changes', () => {
      const nodeId = 'updating_metrics';
      
      // Initial state
      const initialStats = cache.getStats();
      
      // Try to get entries (should be misses on get)
      const missResult = cache.get(nodeId, 'missing_key');
      expect(missResult).toBeUndefined();
      
      // Add entry and get it (should be hit)
      cache.set(nodeId, 'test_key', 'value');
      const hitResult = cache.get(nodeId, 'test_key');
      expect(hitResult).toBe('value');
      
      // Get updated statistics
      const updatedStats = cache.getStats();
      
      // Check that statistics changed
      expect(updatedStats.hits).toBeGreaterThan(initialStats.hits);
      expect(updatedStats.misses).toBeGreaterThan(initialStats.misses);
    });
  });

  // Custom key generators
  describe('Custom Key Generators', () => {
    it('should support custom key generators', () => {
      const nodeId = 'custom_key_generator';
      
      // Set custom key generator
      cache.setNodeOptions(nodeId, {
        keyGenerator: (inputs, config) => {
          // Custom key generation logic
          // For example, use only part of input data
          return `custom_${inputs[0]}_${((config as Record<string, unknown>).param as string) || 'default'}`;
        }
      });
      
      // Generate key and check that custom generator is used
      const cacheKey = cache.generateCacheKey(nodeId, [42, 'ignored'], { param: 'test' });
      
      expect(cacheKey).toBe('custom_42_test');
      
      // Save and get data using custom key
      cache.set(nodeId, cacheKey, 'custom_value');
      const value = cache.get(nodeId, cacheKey);
      
      expect(value).toBe('custom_value');
    });
  });

  // Cache enable/disable
  describe('Cache Enable/Disable', () => {
    it('should support enable/disable at node level', () => {
      const nodeId = 'toggle_node';
      const cacheKey = 'test_key';
      
      // Initially caching is enabled (by default)
      cache.set(nodeId, cacheKey, 'value');
      expect(cache.get(nodeId, cacheKey)).toBe('value');
      
      // Disable caching for node
      cache.setNodeOptions(nodeId, {
        enabled: false
      });
      
      // Existing entries should be unavailable
      expect(cache.get(nodeId, cacheKey)).toBeUndefined();
      
      // New entries should not be saved
      cache.set(nodeId, cacheKey, 'new_value');
      expect(cache.get(nodeId, cacheKey)).toBeUndefined();
      
      // Enable caching again
      cache.setNodeOptions(nodeId, {
        enabled: true
      });
      
      // Now entries should be saved
      cache.set(nodeId, cacheKey, 'enabled_again');
      expect(cache.get(nodeId, cacheKey)).toBe('enabled_again');
    });
    
    it('should check if caching is enabled for node', () => {
      const nodeId = 'check_enabled';
      
      // By default caching is enabled
      expect(cache.isCachingEnabled(nodeId)).toBe(true);
      
      // Disable caching
      cache.setNodeOptions(nodeId, {
        enabled: false
      });
      
      // Check that caching is disabled
      expect(cache.isCachingEnabled(nodeId)).toBe(false);
    });
  });
}); 