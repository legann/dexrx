import { createGraph } from '../lib/dexrx/src/graph';
import { withNodesConfig, withOptions } from '../lib/dexrx/src/operators';
import { INIT_NODE_EXEC } from '../lib/dexrx/src/types/engine-flags';
import { INodePlugin } from 'dexrx';

// Plugin that throws error under certain conditions
const errorThrowingPlugin: INodePlugin = {
  type: "ErrorThrower",
  category: 'operational',
  compute: (config: any, inputs: any[]) => {
    // Synchronous failure if specified in configuration
    if (config.throwSync) {
      throw new Error(`Synchronous error from node: ${config.message || 'No message'}`);
    }
    
    // Asynchronous failure if specified in configuration
    if (config.throwAsync) {
      return Promise.reject(new Error(`Asynchronous error from node: ${config.message || 'No message'}`));
    }
    
    // If shouldTimeout is set, never return result (for testing timeouts)
    if (config.shouldTimeout) {
      return new Promise(() => {
        // Intentionally don't resolve or reject promise
      });
    }
    
    // If shouldReturnUndefined is set, return undefined
    if (config.shouldReturnUndefined) {
      return undefined;
    }
    
    // By default return value from config or input data
    if (config && typeof config.value !== 'undefined') {
      return config.value;
    }
    
    return inputs && inputs.length > 0 ? inputs[0] : null;
  }
};

describe("ExecutableGraph - Error handling (Build API)", () => {
  it("should correctly handle synchronous errors", async () => {
    const graph = createGraph(
      withOptions({
        engine: {
          silentErrors: false // Enable error logging
        }
      }),
      withNodesConfig({
        nodesPlugins: [errorThrowingPlugin],
        nodes: [
          {
            id: "errorNode",
            type: "ErrorThrower",
            config: {
              throwSync: true,
              message: "Synchronous error test",
              isSubscribed: true
            }
          }
        ]
      })
    );

    await graph.execute();
    await new Promise(resolve => setTimeout(resolve, 200));

    const state = graph.exportState();
    // On node error, value should be null
    expect(state.nodes["errorNode"].currentValue).toBeNull();

    // Check that error was registered in stats
    const stats = graph.getStats();
    expect(stats.errorCount).toBeGreaterThan(0);

    graph.destroy();
  });

  it("should correctly handle asynchronous errors", async () => {
    const graph = createGraph(
      withOptions({
        engine: {
          silentErrors: false
        }
      }),
      withNodesConfig({
        nodesPlugins: [errorThrowingPlugin],
        nodes: [
          {
            id: "errorNode",
            type: "ErrorThrower",
            config: {
              throwAsync: true,
              message: "Asynchronous error test",
              isSubscribed: true
            }
          }
        ]
      })
    );

    await graph.execute();
    await new Promise(resolve => setTimeout(resolve, 200));

    const state = graph.exportState();
    // On node error, value should be null
    expect(state.nodes["errorNode"].currentValue).toBeNull();

    // Check that error was registered in stats
    const stats = graph.getStats();
    expect(stats.errorCount).toBeGreaterThan(0);

    graph.destroy();
  });

  it("should handle errors in dependent nodes", async () => {
    const graph = createGraph(
      withOptions({
        engine: {
          silentErrors: false
        }
      }),
      withNodesConfig({
        nodesPlugins: [errorThrowingPlugin],
        nodes: [
          {
            id: "sourceNode",
            type: "ErrorThrower",
            config: {
              value: 10
            }
          },
          {
            id: "errorNode",
            type: "ErrorThrower",
            inputs: ["sourceNode"],
            config: {
              throwSync: true,
              message: "Error in dependent node",
              isSubscribed: true
            }
          }
        ]
      })
    );

    await graph.execute();
    await new Promise(resolve => setTimeout(resolve, 200));

    const state = graph.exportState();
    // Source node should have value
    expect(state.nodes["sourceNode"].currentValue).toBe(10);
    // Error node should have null due to error
    expect(state.nodes["errorNode"].currentValue).toBeNull();

    graph.destroy();
  });

  it("should continue processing other nodes after error", async () => {
    const graph = createGraph(
      withOptions({
        engine: {
          silentErrors: false
        }
      }),
      withNodesConfig({
        nodesPlugins: [errorThrowingPlugin],
        nodes: [
          {
            id: "errorNode",
            type: "ErrorThrower",
            config: {
              throwSync: true,
              message: "Error test"
            }
          },
          {
            id: "normalNode",
            type: "ErrorThrower",
            config: {
              value: 42,
              isSubscribed: true
            }
          }
        ]
      })
    );

    await graph.execute();
    await new Promise(resolve => setTimeout(resolve, 200));

    const state = graph.exportState();
    // Error node should have null
    expect(state.nodes["errorNode"].currentValue).toBeNull();
    // Normal node should have value
    expect(state.nodes["normalNode"].currentValue).toBe(42);

    graph.destroy();
  });

  it("should handle undefined return values", async () => {
    const graph = createGraph(
      withNodesConfig({
        nodesPlugins: [errorThrowingPlugin],
        nodes: [
          {
            id: "undefinedNode",
            type: "ErrorThrower",
            config: {
              shouldReturnUndefined: true
              // Not subscribed - rely on activeTasks for stabilization
            }
          }
        ]
      })
    );

    // Execute with timeout - undefined should be handled gracefully
    await graph.execute({ timeout: 5000 });

    const state = graph.exportState();
    // Undefined should be handled gracefully
    expect(state.nodes["undefinedNode"].currentValue).toBeUndefined();

    graph.destroy();
  }, 10000); // Increase test timeout to 10 seconds

  it("should track error count in statistics", async () => {
    const graph = createGraph(
      withOptions({
        engine: {
          silentErrors: false
        }
      }),
      withNodesConfig({
        nodesPlugins: [errorThrowingPlugin],
        nodes: [
          {
            id: "errorNode1",
            type: "ErrorThrower",
            config: {
              throwSync: true,
              message: "Error 1"
            }
          },
          {
            id: "errorNode2",
            type: "ErrorThrower",
            config: {
              throwAsync: true,
              message: "Error 2"
            }
          }
        ]
      })
    );

    await graph.execute();
    await new Promise(resolve => setTimeout(resolve, 200));

    const stats = graph.getStats();
    // Should have at least 2 errors (one from each error node)
    expect(stats.errorCount).toBeGreaterThanOrEqual(2);

    graph.destroy();
  });

  it("should handle errors with silentErrors enabled", async () => {
    const graph = createGraph(
      withOptions({
        engine: {
          silentErrors: true // Errors are silent but still tracked
        }
      }),
      withNodesConfig({
        nodesPlugins: [errorThrowingPlugin],
        nodes: [
          {
            id: "errorNode",
            type: "ErrorThrower",
            config: {
              throwSync: true,
              message: "Silent error test",
              isSubscribed: true
            }
          }
        ]
      })
    );

    await graph.execute();
    await new Promise(resolve => setTimeout(resolve, 200));

    const state = graph.exportState();
    // Error should still result in null value
    expect(state.nodes["errorNode"].currentValue).toBeNull();

    // Error should still be tracked
    const stats = graph.getStats();
    expect(stats.errorCount).toBeGreaterThan(0);

    graph.destroy();
  });
});
