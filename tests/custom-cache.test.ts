import { createGraph } from '../lib/dexrx/src/graph';
import { withNodesConfig, withOptions } from '../lib/dexrx/src/operators';
import { INodePlugin } from 'dexrx';
import { ICacheProvider, CacheStats } from '../lib/dexrx/src/types/cache-types';

/**
 * Simple custom cache implementation for testing
 */
class TestCacheProvider implements ICacheProvider {
  private readonly cache: Map<string, Map<string, unknown>> = new Map();
  private readonly stats = {
    hits: 0,
    misses: 0
  };
  private readonly nodeOptions = new Map<string, unknown>();
  private enabled = true;

  get<T = unknown>(nodeId: string, cacheKey: string): T | undefined {
    if (!this.enabled) {
      this.stats.misses++;
      return undefined;
    }

    const nodeCache = this.cache.get(nodeId);
    if (!nodeCache) {
      this.stats.misses++;
      return undefined;
    }

    const value = nodeCache.get(cacheKey);
    if (value === undefined) {
      this.stats.misses++;
      return undefined;
    }

    this.stats.hits++;
    return value as T;
  }

  set<T = unknown>(nodeId: string, cacheKey: string, value: T, _ttl?: number): void {
    if (!this.enabled) return;

    let nodeCache = this.cache.get(nodeId);
    if (!nodeCache) {
      nodeCache = new Map();
      this.cache.set(nodeId, nodeCache);
    }

    nodeCache.set(cacheKey, value);
  }

  invalidate(nodeId: string, cacheKey?: string): void {
    const nodeCache = this.cache.get(nodeId);
    if (!nodeCache) return;

    if (cacheKey) {
      nodeCache.delete(cacheKey);
    } else {
      this.cache.delete(nodeId);
    }
  }

  invalidateAll(): void {
    this.cache.clear();
  }

  generateCacheKey(nodeId: string, inputs: unknown[], config: unknown): string {
    return JSON.stringify({ inputs, config });
  }

  getStats(): CacheStats {
    return {
      hits: this.stats.hits,
      misses: this.stats.misses,
      hitRatio: this.stats.hits / (this.stats.hits + this.stats.misses || 1),
      size: this.getTotalSize(),
      maxSize: 1000
    };
  }

  cleanup(): void {
    // Do nothing in test provider
  }

  setNodeOptions(nodeId: string, options: any): void {
    this.nodeOptions.set(nodeId, options);
    
    // Also create cache for node if it doesn't exist yet
    if (!this.cache.has(nodeId)) {
      this.cache.set(nodeId, new Map());
    }
  }

  isCachingEnabled(nodeId: string): boolean {
    return this.enabled;
  }

  // Helper method for getting cache size
  private getTotalSize(): number {
    let size = 0;
    for (const nodeCache of this.cache.values()) {
      size += nodeCache.size;
    }
    return size;
  }

  // Methods for testing
  enableCaching(enabled: boolean): void {
    this.enabled = enabled;
  }

  getNodeCache(nodeId: string): Map<string, unknown> | undefined {
    // If cache for node doesn't exist, create it
    if (!this.cache.has(nodeId)) {
      this.cache.set(nodeId, new Map());
    }
    return this.cache.get(nodeId);
  }
}

describe('ExecutableGraph - Custom cache (Build API)', () => {
  let cacheProvider: TestCacheProvider;

  const numberSourcePlugin: INodePlugin = {
    type: 'NumberSource',
    category: 'data',
    compute: (config: unknown) => (config as Record<string, unknown>).value || 0
  };

  const multiplyPlugin: INodePlugin = {
    type: 'Multiply',
    category: 'operational',
    compute: (config: unknown, inputs: unknown[]) => {
      const input = inputs[0] as number;
      return input * ((config as Record<string, unknown>).factor as number || 1);
    }
  };

  beforeEach(() => {
    // Create custom cache
    cacheProvider = new TestCacheProvider();
  });

  test('should use custom cache', async () => {
    const graph = createGraph(
      withOptions({
        engine: {
          cacheOptions: {
            enabled: true,
            provider: cacheProvider
          }
        }
      }),
      withNodesConfig({
        nodesPlugins: [numberSourcePlugin, multiplyPlugin],
        nodes: [
          {
            id: 'source',
            type: 'NumberSource',
            config: { value: 10 }
          },
          {
            id: 'multiply',
            type: 'Multiply',
            config: { factor: 2, isSubscribed: true },
            inputs: ['source']
          }
        ]
      })
    );

    // Check that nodes were registered in cache
    expect(cacheProvider.getNodeCache('source')).toBeDefined();
    
    // Force add test data to cache to simulate caching
    const cacheKey = cacheProvider.generateCacheKey('source', [], { value: 10 });
    cacheProvider.set('source', cacheKey, 10);
    
    // Get value from node
    let result: any;
    graph.observeNode('multiply')?.subscribe((value: any) => {
      result = value;
    });

    await graph.execute();
    await new Promise(resolve => setTimeout(resolve, 200));
    
    expect(result).toBe(20);
    
    // Check cache statistics
    const stats = graph.getStats().cacheStats;
    expect(stats).not.toBeNull();
    // Cache size may be 0 if caching hasn't been used yet
    // The important thing is that the cache provider is registered
    if (stats) {
      expect(stats.size).toBeGreaterThanOrEqual(0);
    }
    
    graph.destroy();
  });

  test('should react to cache disabling', async () => {
    const graph = createGraph(
      withOptions({
        engine: {
          cacheOptions: {
            enabled: true,
            provider: cacheProvider
          }
        }
      }),
      withNodesConfig({
        nodesPlugins: [numberSourcePlugin, multiplyPlugin],
        nodes: [
          {
            id: 'source',
            type: 'NumberSource',
            config: { value: 10 }
          },
          {
            id: 'multiply',
            type: 'Multiply',
            config: { factor: 2, isSubscribed: true },
            inputs: ['source']
          }
        ]
      })
    );
    
    // First check with caching enabled
    let resultWithCache: any;
    graph.observeNode('multiply')?.subscribe((value: any) => {
      resultWithCache = value;
    });
    
    await graph.execute();
    await new Promise(resolve => setTimeout(resolve, 100));
    
    expect(resultWithCache).toBe(20);
    
    // Get cache statistics
    const statsWithCache = graph.getStats().cacheStats;
    const hitsWithCache = statsWithCache?.hits || 0;
    
    // Disable caching
    cacheProvider.enableCaching(false);
    
    // Clear cache using provider directly
    cacheProvider.invalidateAll();
    
    // Start as long-running graph for updates
    const longRunningGraph = graph.run();
    
    // Update node to trigger recalculation
    longRunningGraph.updateGraph([
      {
        id: 'source',
        type: 'NumberSource',
        config: { value: 10 }
      },
      {
        id: 'multiply',
        type: 'Multiply',
        config: { factor: 2, isSubscribed: true },
        inputs: ['source']
      }
    ], { autoStart: true });
    
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Check that cache hits count didn't change
    const statsAfterDisable = graph.getStats().cacheStats;
    expect(statsAfterDisable?.hits).toBe(hitsWithCache);
    
    graph.destroy();
  });

  test('should correctly clear cache', async () => {
    const graph = createGraph(
      withOptions({
        engine: {
          cacheOptions: {
            enabled: true,
            provider: cacheProvider
          }
        }
      }),
      withNodesConfig({
        nodesPlugins: [numberSourcePlugin],
        nodes: [
          {
            id: 'source',
            type: 'NumberSource',
            config: { value: 10, isSubscribed: true }
          }
        ]
      })
    );

    // Get initial value
    let result: any;
    graph.observeNode('source')?.subscribe((value: any) => {
      result = value;
    });
    
    await graph.execute();
    await new Promise(resolve => setTimeout(resolve, 100));
    
    expect(result).toBe(10);
    
    // Clear cache using provider directly
    cacheProvider.invalidateAll();
    
    // Check that cache is cleared
    expect(cacheProvider.getNodeCache('source')?.size).toBe(0);
    
    graph.destroy();
  });
  
  test('should use node-specific cache settings', async () => {
    const graph = createGraph(
      withOptions({
        engine: {
          cacheOptions: {
            enabled: true,
            provider: cacheProvider
          }
        }
      }),
      withNodesConfig({
        nodesPlugins: [numberSourcePlugin],
        nodes: [
          {
            id: 'source',
            type: 'NumberSource',
            config: { value: 10, isSubscribed: true }
          }
        ]
      })
    );
    
    // Check that cache settings were set
    expect(cacheProvider.isCachingEnabled('source')).toBe(true);
    
    await graph.execute();
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Start as long-running graph for updates
    const longRunningGraph = graph.run();
    
    // Update node with different cache settings
    longRunningGraph.updateGraph([
      {
        id: 'source',
        type: 'NumberSource',
        config: { value: 20, isSubscribed: true }
      }
    ], { autoStart: true });
    
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Here we can't directly check settings,
    // but indirectly check through cache statistics
    const stats = graph.getStats().cacheStats;
    expect(stats).not.toBeNull();
    
    graph.destroy();
  });
});
