import { createGraph } from '../lib/dexrx/src/graph';
import { withNodesConfig, withCacheProvider } from '../lib/dexrx/src/operators';
import { MemoryCacheProvider } from '../lib/dexrx/src/providers/memory/cache';
import { INodePlugin } from 'dexrx';

// Type for heavy compute result
type HeavyComputeResult = {
  result: number;
  callCount: number;
  inputs: unknown[];
};

// Plugin for testing caching
// Note: In Build API, caching is handled by the cache provider
// The plugin itself doesn't need to handle caching directly
const heavyComputePlugin: INodePlugin = {
  type: "HeavyCompute",
  category: 'operational',
  compute: (config: any, inputs: any[]) => {
    // Increment call counter
    config.callCount = (config.callCount || 0) + 1;
    
    // Simulate heavy computations
    const complexity = config.complexity || 100000;
    let result = 0;
    for (let i = 0; i < complexity; i++) {
      result += Math.sin(i * 0.01);
    }
    
    return {
      result,
      callCount: config.callCount,
      inputs: inputs.slice()
    };
  }
};

describe("NodeCache - Node Caching (Build API)", () => {
  it("should support cache provider registration", async () => {
    const cacheProvider = new MemoryCacheProvider(1000);
    
    const graph = createGraph(
      withCacheProvider(cacheProvider),
      withNodesConfig({
        nodesPlugins: [heavyComputePlugin],
        nodes: [
          {
            id: "heavyNode",
            type: "HeavyCompute",
            config: { complexity: 100000, isSubscribed: true }
          }
        ]
      })
    );

    await graph.execute();
    await new Promise(resolve => setTimeout(resolve, 200));

    // Check that graph works
    const state = graph.exportState();
    expect(state.nodes["heavyNode"].currentValue).toBeDefined();

    // Check that cache provider is registered
    const stats = cacheProvider.getStats();
    expect(stats).toBeDefined();

    graph.destroy();
  });

  it("should compute node values", async () => {
    const graph = createGraph(
      withCacheProvider(new MemoryCacheProvider(1000)),
      withNodesConfig({
        nodesPlugins: [heavyComputePlugin],
        nodes: [
          {
            id: "heavyNode",
            type: "HeavyCompute",
            config: { complexity: 100000, callCount: 0, isSubscribed: true }
          }
        ]
      })
    );

    await graph.execute();
    await new Promise(resolve => setTimeout(resolve, 200));

    const state = graph.exportState();
    const value = state.nodes["heavyNode"].currentValue as HeavyComputeResult;
    
    expect(value).toBeDefined();
    expect(value.callCount).toBeGreaterThan(0);
    expect(value.result).toBeDefined();

    graph.destroy();
  });

  it("should support cache provider statistics", async () => {
    const cacheProvider = new MemoryCacheProvider(1000);
    
    const graph = createGraph(
      withCacheProvider(cacheProvider),
      withNodesConfig({
        nodesPlugins: [heavyComputePlugin],
        nodes: [
          {
            id: "heavyNode",
            type: "HeavyCompute",
            config: { complexity: 50000, isSubscribed: true }
          }
        ]
      })
    );

    await graph.execute();
    await new Promise(resolve => setTimeout(resolve, 200));

    // Check cache statistics
    const stats = cacheProvider.getStats();
    expect(stats).toBeDefined();
    expect(stats.hits).toBeGreaterThanOrEqual(0);
    expect(stats.misses).toBeGreaterThanOrEqual(0);
    expect(stats.size).toBeGreaterThanOrEqual(0);

    graph.destroy();
  });

  it("should support cache invalidation", async () => {
    const cacheProvider = new MemoryCacheProvider(1000);
    
    const graph = createGraph(
      withCacheProvider(cacheProvider),
      withNodesConfig({
        nodesPlugins: [heavyComputePlugin],
        nodes: [
          {
            id: "heavyNode",
            type: "HeavyCompute",
            config: { complexity: 50000, isSubscribed: true }
          }
        ]
      })
    );

    await graph.execute();
    await new Promise(resolve => setTimeout(resolve, 200));

    // Invalidate cache
    await cacheProvider.invalidateAll();

    // Check that cache is cleared
    const stats = cacheProvider.getStats();
    expect(stats.size).toBe(0);

    graph.destroy();
  });

  it("should work with multiple nodes and cache provider", async () => {
    const cacheProvider = new MemoryCacheProvider(1000);
    
    const graph = createGraph(
      withCacheProvider(cacheProvider),
      withNodesConfig({
        nodesPlugins: [heavyComputePlugin],
        nodes: [
          {
            id: "node1",
            type: "HeavyCompute",
            config: { complexity: 50000, isSubscribed: true }
          },
          {
            id: "node2",
            type: "HeavyCompute",
            config: { complexity: 50000, isSubscribed: true }
          }
        ]
      })
    );

    await graph.execute();
    await new Promise(resolve => setTimeout(resolve, 200));

    const state = graph.exportState();
    expect(state.nodes["node1"].currentValue).toBeDefined();
    expect(state.nodes["node2"].currentValue).toBeDefined();

    // Check cache statistics
    const stats = cacheProvider.getStats();
    expect(stats).toBeDefined();

    graph.destroy();
  });
});
