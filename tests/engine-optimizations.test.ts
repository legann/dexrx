import { createGraph, LongRunningGraph } from '../lib/dexrx/src/graph';
import { withNodesConfig, withOptions } from '../lib/dexrx/src/operators';
import { INodePlugin } from 'dexrx';

// Plugin with computation error for testing error handling
const errorPlugin: INodePlugin = {
  type: "Error",
  category: 'operational',
  compute: (config: unknown, _inputs: unknown[]) => {
    const shouldThrow = (config as Record<string, unknown>).shouldThrow || false;
    if (shouldThrow) {
      throw new Error("Test computation error");
    }
    return (config as Record<string, unknown>).value || 0;
  }
};

// Simple plugin for testing
const simplePlugin: INodePlugin = {
  type: "Simple",
  category: 'operational',
  compute: (config: unknown, inputs: unknown[]) => {
    return (config as Record<string, unknown>).value || 0;
  }
};

// Plugin for checking various input data
const sumPlugin: INodePlugin = {
  type: "Sum",
  category: 'operational',
  compute: (config: unknown, inputs: unknown[]) => {
    return inputs.reduce((acc: number, val: number) => acc + (val || 0), 0);
  }
};

describe("ExecutableGraph - Optimizations (Build API)", () => {
  it("should handle errors in computation function", async () => {
    const graph = createGraph(
      withOptions({
        engine: {
          silentErrors: true
        }
      }),
      withNodesConfig({
        nodesPlugins: [errorPlugin],
        nodes: [
          {
            id: "error-node",
            type: "Error",
            config: { shouldThrow: true, isSubscribed: true }
          }
        ]
      })
    );

    await graph.execute();
    await new Promise(resolve => setTimeout(resolve, 100));

    const state = graph.exportState();
    // Should return null on error
    expect(state.nodes["error-node"].currentValue).toBeNull();

    graph.destroy();
  });

  it("should work with distinctValues option", async () => {
    const graph = createGraph(
      withOptions({
        engine: {
          distinctValues: true  // Enable distinct option
        }
      }),
      withNodesConfig({
        nodesPlugins: [simplePlugin],
        nodes: [
          {
            id: "static",
            type: "Simple",
            config: { value: 123, isSubscribed: true }
          }
        ]
      })
    );

    await graph.execute();
    await new Promise(resolve => setTimeout(resolve, 100));

    // Start as long-running graph for updates
    const longRunningGraph: LongRunningGraph = graph.run();

    // Update with same value (should be filtered by distinctValues)
    longRunningGraph.updateGraph([
      {
        id: "static",
        type: "Simple",
        config: { value: 123, isSubscribed: true } // Same value
      }
    ], { autoStart: true });

    await new Promise(resolve => setTimeout(resolve, 50));

    // Update with new value
    longRunningGraph.updateGraph([
      {
        id: "static",
        type: "Simple",
        config: { value: 456, isSubscribed: true } // New value
      }
    ], { autoStart: true });

    await new Promise(resolve => setTimeout(resolve, 100));

    const state = graph.exportState();
    // Final value should be 456
    expect(state.nodes["static"].currentValue).toBe(456);

    graph.destroy();
  });

  it("should correctly free resources when destroyed", async () => {
    const graph = createGraph(
      withNodesConfig({
        nodesPlugins: [simplePlugin],
        nodes: [
          {
            id: "source",
            type: "Simple",
            config: { value: 42 }
          }
        ]
      })
    );

    // Destroy graph
    graph.destroy();

    // Check that after destruction cannot perform operations (should throw error)
    // Note: execute() is async, so we need to check the promise rejection
    await expect(graph.execute()).rejects.toThrow();
  });

  it("should respect debounce setting", async () => {
    const graph = createGraph(
      withOptions({
        engine: {
          debounceTime: 50  // 50ms debounce
        }
      }),
      withNodesConfig({
        nodesPlugins: [simplePlugin],
        nodes: [
          {
            id: "source",
            type: "Simple",
            config: { value: 0, isSubscribed: true }
          }
        ]
      })
    );

    await graph.execute();
    await new Promise(resolve => setTimeout(resolve, 100));

    // Start as long-running graph for updates
    const longRunningGraph: LongRunningGraph = graph.run();

    // Start series of rapid updates
    longRunningGraph.updateGraph([
      {
        id: "source",
        type: "Simple",
        config: { value: 1, isSubscribed: true }
      }
    ], { autoStart: true });
    await new Promise(resolve => setTimeout(resolve, 10));

    longRunningGraph.updateGraph([
      {
        id: "source",
        type: "Simple",
        config: { value: 2, isSubscribed: true }
      }
    ], { autoStart: true });
    await new Promise(resolve => setTimeout(resolve, 10));

    longRunningGraph.updateGraph([
      {
        id: "source",
        type: "Simple",
        config: { value: 3, isSubscribed: true }
      }
    ], { autoStart: true });
    await new Promise(resolve => setTimeout(resolve, 10));

    longRunningGraph.updateGraph([
      {
        id: "source",
        type: "Simple",
        config: { value: 4, isSubscribed: true }
      }
    ], { autoStart: true });
    await new Promise(resolve => setTimeout(resolve, 10));

    longRunningGraph.updateGraph([
      {
        id: "source",
        type: "Simple",
        config: { value: 5, isSubscribed: true }
      }
    ], { autoStart: true });

    // Wait for debounce to complete
    await new Promise(resolve => setTimeout(resolve, 100));

    const state = graph.exportState();
    // Check that last value was received (debounce should allow final value)
    expect(state.nodes["source"].currentValue).toBe(5);

    graph.destroy();
  });

  it("should work with combination of optimizations", async () => {
    const graph = createGraph(
      withOptions({
        engine: {
          debounceTime: 30,
          distinctValues: true
        }
      }),
      withNodesConfig({
        nodesPlugins: [simplePlugin],
        nodes: [
          {
            id: "combined",
            type: "Simple",
            config: { value: [1, 2], isSubscribed: true }
          }
        ]
      })
    );

    await graph.execute();
    await new Promise(resolve => setTimeout(resolve, 100));

    // Start as long-running graph for updates
    const longRunningGraph: LongRunningGraph = graph.run();

    // Series of updates
    longRunningGraph.updateGraph([
      {
        id: "combined",
        type: "Simple",
        config: { value: [1, 2], isSubscribed: true } // Same value
      }
    ], { autoStart: true });
    await new Promise(resolve => setTimeout(resolve, 60));

    longRunningGraph.updateGraph([
      {
        id: "combined",
        type: "Simple",
        config: { value: [3, 4], isSubscribed: true } // New value
      }
    ], { autoStart: true });
    await new Promise(resolve => setTimeout(resolve, 60));

    longRunningGraph.updateGraph([
      {
        id: "combined",
        type: "Simple",
        config: { value: [3, 4], isSubscribed: true } // Same value
      }
    ], { autoStart: true });
    await new Promise(resolve => setTimeout(resolve, 60));

    longRunningGraph.updateGraph([
      {
        id: "combined",
        type: "Simple",
        config: { value: [5, 6], isSubscribed: true } // New value
      }
    ], { autoStart: true });

    // Wait for debounce to complete
    await new Promise(resolve => setTimeout(resolve, 100));

    const state = graph.exportState();
    // Check that last value is correct
    expect(state.nodes["combined"].currentValue).toEqual([5, 6]);

    graph.destroy();
  });
});
