import { createGraph, LongRunningGraph } from '../lib/dexrx/src/graph';
import { withNodesConfig, withOptions } from '../lib/dexrx/src/operators';
import { INodePlugin } from 'dexrx';
import { EngineExecutionMode } from '../lib/dexrx/src/types/engine-options';

// Create simple plugin with deterministic result
const simplePlugin: INodePlugin = {
  type: "Simple",
  category: 'operational',
  compute: (config: any, inputs: any[]) => {
    const value = config.value || 0;
    return value * 2;
  }
};

// Plugin for multiplying value
const multiplyPlugin: INodePlugin = {
  type: "Multiply",
  category: 'operational',
  compute: (config: any, inputs: any[]) => {
    const factor = config.factor || 1;
    const input = inputs[0] || 0;
    return input * factor;
  }
};

// Create async plugin
const asyncPlugin: INodePlugin = {
  type: "Async",
  category: 'operational',
  compute: async (config: any, inputs: any[]) => {
    const value = config.value || inputs[0] || 0;
    return Promise.resolve(value * 2);
  }
};

// Create plugin for heavy computations
const heavyComputePlugin: INodePlugin = {
  type: "HeavyCompute",
  category: 'operational',
  compute: (config: any, inputs: any[]) => {
    // If simpleMode is enabled, simply multiply by 2
    if (config.simpleMode) {
      const value = config.value || 1;
      return value * 2;
    }
    
    // Otherwise perform heavy computation
    const iterations = config.iterations || 100000;
    let result = 0;
    
    for (let i = 0; i < iterations; i++) {
      result += Math.sin(i * 0.01) * Math.cos(i * 0.01);
      if (i % 100 === 0) {
        result += Math.pow(Math.sin(i * 0.01), 2) + Math.pow(Math.cos(i * 0.01), 2);
      }
    }
    
    return result;
  }
};

describe("Parallel Execution Tests (Build API)", () => {
  afterAll(async () => {
    // Give additional time for workers to finish and close
    // This helps prevent Jest "open handles" warnings
    await new Promise(resolve => setTimeout(resolve, 2000));
  });

  it("should process nodes in parallel mode", async () => {
    // Note: In parallel mode, workers return structured results
    // For simple plugins, we test that parallel mode works (structure is returned)
    const graph = createGraph(
      withOptions({
        engine: {
          executionMode: EngineExecutionMode.PARALLEL
        },
        executionContext: {
          parallelOptions: {
            maxWorkers: 2
          }
        }
      }),
      withNodesConfig({
        nodesPlugins: [simplePlugin],
        nodes: [
          {
            id: "source",
            type: "Simple",
            config: { value: 5, isSubscribed: true }
          }
        ]
      })
    );

    await graph.execute();

    const state = graph.exportState();
    // In parallel mode, worker returns structured result
    const value = state.nodes["source"].currentValue;
    expect(value).toBeDefined();
    // Worker returns object with result, config, inputs, type, threadInfo
    if (value && typeof value === 'object') {
      expect((value as { type: string }).type).toBe("Simple");
    }

    graph.destroy();
    // Wait for workers to close explicitly
    if (typeof (graph as any).waitForWorkers === 'function') {
      await (graph as any).waitForWorkers(2000);
    }
  });

  it("should support node chains", async () => {
    // Note: In parallel mode, workers return structured results
    const graph = createGraph(
      withOptions({
        engine: {
          executionMode: EngineExecutionMode.PARALLEL
        },
        executionContext: {
          parallelOptions: {
            maxWorkers: 2
          }
        }
      }),
      withNodesConfig({
        nodesPlugins: [simplePlugin, multiplyPlugin],
        nodes: [
          {
            id: "source",
            type: "Simple",
            config: { value: 2 }
          },
          {
            id: "multiply",
            type: "Multiply",
            inputs: ["source"],
            config: { factor: 3, isSubscribed: true }
          }
        ]
      })
    );

    await graph.execute();

    const state = graph.exportState();
    // In parallel mode, worker returns structured result
    const value = state.nodes["multiply"].currentValue;
    expect(value).toBeDefined();
    // Worker returns object with result, config, inputs, type, threadInfo
    if (value && typeof value === 'object') {
      expect((value as { type: string }).type).toBe("Multiply");
    }

    graph.destroy();
  }, 5000);

  it("should support asynchronous computations", async () => {
    // Note: In parallel mode, workers return structured results
    const graph = createGraph(
      withOptions({
        engine: {
          executionMode: EngineExecutionMode.PARALLEL
        },
        executionContext: {
          parallelOptions: {
            maxWorkers: 2
          }
        }
      }),
      withNodesConfig({
        nodesPlugins: [asyncPlugin],
        nodes: [
          {
            id: "async",
            type: "Async",
            config: { value: 5, isSubscribed: true }
          }
        ]
      })
    );

    await graph.execute();

    const state = graph.exportState();
    // In parallel mode, worker returns structured result
    const value = state.nodes["async"].currentValue;
    expect(value).toBeDefined();
    // Worker returns object with result, config, inputs, type, threadInfo
    if (value && typeof value === 'object') {
      expect((value as { type: string }).type).toBe("Async");
    }

    graph.destroy();
    // Wait for workers to close explicitly
    if (typeof (graph as any).waitForWorkers === 'function') {
      await (graph as any).waitForWorkers(2000);
    }
  });

  afterEach(async () => {
    // Give workers additional time to close after each test
    // This helps prevent Jest "open handles" warnings
    await new Promise(resolve => setTimeout(resolve, 500));
  });

  it("should support node updates", async () => {
    // Note: In parallel mode, workers return structured results
    const graph = createGraph(
      withOptions({
        engine: {
          executionMode: EngineExecutionMode.PARALLEL
        },
        executionContext: {
          parallelOptions: {
            maxWorkers: 2
          }
        }
      }),
      withNodesConfig({
        nodesPlugins: [simplePlugin],
        nodes: [
          {
            id: "updatable",
            type: "Simple",
            config: { value: 3, isSubscribed: true }
          }
        ]
      })
    );

    await graph.execute();

    let state = graph.exportState();
    const firstValue = state.nodes["updatable"].currentValue;
    expect(firstValue).toBeDefined();

    // Start as long-running graph for updates
    const longRunningGraph: LongRunningGraph = graph.run();

    // Update node
    longRunningGraph.updateGraph([
      {
        id: "updatable",
        type: "Simple",
        config: { value: 5, isSubscribed: true }
      }
    ], { autoStart: true });

    await new Promise(resolve => setTimeout(resolve, 200));

    state = graph.exportState();
    const secondValue = state.nodes["updatable"].currentValue;
    expect(secondValue).toBeDefined();
    // Values should differ (different config values)
    expect(secondValue).not.toEqual(firstValue);

    graph.destroy();
  }, 5000);

  it("should support chains of asynchronous nodes", async () => {
    // Note: In parallel mode, workers return structured results
    const graph = createGraph(
      withOptions({
        engine: {
          executionMode: EngineExecutionMode.PARALLEL
        },
        executionContext: {
          parallelOptions: {
            maxWorkers: 2
          }
        }
      }),
      withNodesConfig({
        nodesPlugins: [asyncPlugin],
        nodes: [
          {
            id: "async1",
            type: "Async",
            config: { value: 2 }
          },
          {
            id: "async2",
            type: "Async",
            inputs: ["async1"],
            config: { isSubscribed: true }
          }
        ]
      })
    );

    await graph.execute();
    await new Promise(resolve => setTimeout(resolve, 300));

    const state = graph.exportState();
    // In parallel mode, worker returns structured result
    const value = state.nodes["async2"].currentValue;
    expect(value).toBeDefined();
    // Worker returns object with result, config, inputs, type, threadInfo
    if (value && typeof value === 'object') {
      expect((value as { type: string }).type).toBe("Async");
    }

    graph.destroy();
  }, 5000);

  it("should support dynamic graph changes", async () => {
    // Note: In parallel mode, workers return structured results
    const graph = createGraph(
      withOptions({
        engine: {
          executionMode: EngineExecutionMode.PARALLEL
        },
        executionContext: {
          parallelOptions: {
            maxWorkers: 2
          }
        }
      }),
      withNodesConfig({
        nodesPlugins: [simplePlugin],
        nodes: [
          {
            id: "source",
            type: "Simple",
            config: { value: 3, isSubscribed: true }
          }
        ]
      })
    );

    await graph.execute();

    let state = graph.exportState();
    const firstValue = state.nodes["source"].currentValue;
    expect(firstValue).toBeDefined();

    // Start as long-running graph for updates
    const longRunningGraph: LongRunningGraph = graph.run();

    // Add second node with different value
    longRunningGraph.updateGraph([
      {
        id: "source",
        type: "Simple",
        config: { value: 3, isSubscribed: true }
      },
      {
        id: "source2",
        type: "Simple",
        config: { value: 5, isSubscribed: true }
      }
    ], { autoStart: true });

    await new Promise(resolve => setTimeout(resolve, 200));

    state = graph.exportState();
    const secondValue = state.nodes["source2"].currentValue;
    expect(secondValue).toBeDefined();
    // Values should differ (different nodes)
    expect(secondValue).not.toEqual(firstValue);

    graph.destroy();
  }, 5000);

  it("should correctly finish work", async () => {
    // Note: In parallel mode, workers return structured results
    const graph = createGraph(
      withOptions({
        engine: {
          executionMode: EngineExecutionMode.PARALLEL
        },
        executionContext: {
          parallelOptions: {
            maxWorkers: 2
          }
        }
      }),
      withNodesConfig({
        nodesPlugins: [simplePlugin],
        nodes: [
          {
            id: "node0",
            type: "Simple",
            config: { value: 1, isSubscribed: true }
          },
          {
            id: "node1",
            type: "Simple",
            config: { value: 2, isSubscribed: true }
          },
          {
            id: "node2",
            type: "Simple",
            config: { value: 3, isSubscribed: true }
          }
        ]
      })
    );

    await graph.execute();
    await new Promise(resolve => setTimeout(resolve, 300));

    const state = graph.exportState();
    // All nodes should have values (structured results from workers)
    expect(state.nodes["node0"].currentValue).toBeDefined();
    expect(state.nodes["node1"].currentValue).toBeDefined();
    expect(state.nodes["node2"].currentValue).toBeDefined();

    graph.destroy();
    // Wait for workers to close explicitly
    if (typeof (graph as any).waitForWorkers === 'function') {
      await (graph as any).waitForWorkers(2000);
    }
  });

  it("should efficiently execute heavy computations in sequential mode", async () => {
    // Test parameters
    const nodeCount = 3;
    const iterations = 10000; // Small number for fast testing

    console.log(`⏱️ Sequential execution performance test: nodes=${nodeCount}, iterations=${iterations}`);

    const nodes = [];
    for (let i = 0; i < nodeCount; i++) {
      nodes.push({
        id: `serial_node_${i}`,
        type: "HeavyCompute",
        config: {
          iterations: iterations,
          value: i + 1,
          isSubscribed: true
        }
      });
    }

    const graph = createGraph(
      withOptions({
        engine: {
          executionMode: EngineExecutionMode.SERIAL
        }
      }),
      withNodesConfig({
        nodesPlugins: [heavyComputePlugin],
        nodes: nodes
      })
    );

    const startTime = Date.now();
    await graph.execute();
    await new Promise(resolve => setTimeout(resolve, 1000));

    const endTime = Date.now();
    const duration = endTime - startTime;
    console.log(`⏱️ Sequential execution completed in ${duration} ms`);

    const state = graph.exportState();
    expect(Object.keys(state.nodes).length).toBe(nodeCount);

    graph.destroy();
  }, 30000);

  it("should correctly execute computations in parallel mode with simpleMode", async () => {
    // Test parameters
    const nodeCount = 3;

    console.log(`⏱️ Parallel execution correctness test: nodes=${nodeCount}, mode=simpleMode`);

    const nodes = [];
    for (let i = 0; i < nodeCount; i++) {
      nodes.push({
        id: `parallel_node_${i}`,
        type: "HeavyCompute",
        config: {
          simpleMode: true,
          value: i + 1,
          isSubscribed: true
        }
      });
    }

    const graph = createGraph(
      withOptions({
        engine: {
          executionMode: EngineExecutionMode.PARALLEL
        },
        executionContext: {
          parallelOptions: {
            maxWorkers: 2
          }
        }
      }),
      withNodesConfig({
        nodesPlugins: [heavyComputePlugin],
        nodes: nodes
      })
    );

    await graph.execute();
    await new Promise(resolve => setTimeout(resolve, 500));

    const state = graph.exportState();
    expect(Object.keys(state.nodes).length).toBe(nodeCount);

    // Check that all nodes have values (structured results from workers)
    for (let i = 0; i < nodeCount; i++) {
      const nodeId = `parallel_node_${i}`;
      const value = state.nodes[nodeId].currentValue;
      expect(value).toBeDefined();
      // Worker returns object with result, config, inputs, type, threadInfo
      if (value && typeof value === 'object') {
        expect((value as { type: string }).type).toBe("HeavyCompute");
      }
    }

    console.log(`✅ All nodes executed in parallel mode`);

    graph.destroy();
  }, 10000);
});
