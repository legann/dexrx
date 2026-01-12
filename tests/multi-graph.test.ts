import { createGraph } from '../lib/dexrx/src/graph';
import { withNodesConfig } from '../lib/dexrx/src/operators';
import { INodePlugin } from 'dexrx';
import { LongRunningGraph } from '../lib/dexrx/src/graph';

/**
 * Simple plugin for testing
 */
const passthroughPlugin: INodePlugin = {
  type: 'passthrough',
  category: 'operational',
  compute: (config: any, inputs: any[]): any => {
    return inputs.length > 0 ? inputs[0] : config?.defaultValue ?? null;
  }
};

/**
 * Plugin for aggregating all inputs
 */
const aggregatorPlugin: INodePlugin = {
  type: 'aggregator',
  category: 'operational',
  compute: (config: any, inputs: any[]): any => {
    // Aggregation mode: sum, avg, concat, ...
    const mode = config?.mode || 'sum';
    
    if (inputs.length === 0) return null;
    
    // Filter undefined and null values
    const validInputs = inputs.filter(val => val !== undefined && val !== null);
    
    // If no values remain after filtering, return null or default value
    if (validInputs.length === 0) {
      return config?.defaultValue ?? null;
    }
    
    switch (mode) {
      case 'sum':
        return validInputs.reduce((acc, val) => acc + val, 0);
      case 'concat':
        return validInputs.join('');
      case 'avg':
        return validInputs.reduce((acc, val) => acc + val, 0) / validInputs.length;
      case 'max':
        return Math.max(...validInputs);
      default:
        return validInputs[0];
    }
  }
};

describe('ExecutableGraph - Multi-graph support (Build API)', () => {
  /**
   * Test: verify that we can create multiple independent subgraphs
   */
  test('should support multiple independent subgraphs', async () => {
    const graph = createGraph(
      withNodesConfig({
        nodesPlugins: [passthroughPlugin],
        nodes: [
          {
            id: 'source1',
            type: 'passthrough',
            config: { defaultValue: 10 }
          },
          {
            id: 'widget1',
            type: 'passthrough',
            inputs: ['source1'],
            config: { isSubscribed: true }
          },
          {
            id: 'source2',
            type: 'passthrough',
            config: { defaultValue: 20 }
          },
          {
            id: 'widget2',
            type: 'passthrough',
            inputs: ['source2'],
            config: { isSubscribed: true }
          }
        ]
      })
    );

    await graph.execute();
    await new Promise(resolve => setTimeout(resolve, 100));

    // Check that both subgraphs work independently
    let state = graph.exportState();
    expect(state.nodes['widget1'].currentValue).toBe(10);
    expect(state.nodes['widget2'].currentValue).toBe(20);

    // Update source only for first widget
    const longRunningGraph: LongRunningGraph = graph.run();
    longRunningGraph.updateGraph([
      {
        id: 'source1',
        type: 'passthrough',
        config: { defaultValue: 15 }
      },
      {
        id: 'widget1',
        type: 'passthrough',
        inputs: ['source1'],
        config: { isSubscribed: true }
      },
      {
        id: 'source2',
        type: 'passthrough',
        config: { defaultValue: 20 }
      },
      {
        id: 'widget2',
        type: 'passthrough',
        inputs: ['source2'],
        config: { isSubscribed: true }
      }
    ], { autoStart: true });

    await new Promise(resolve => setTimeout(resolve, 100));

    // Check that only first widget changed
    state = graph.exportState();
    expect(state.nodes['widget1'].currentValue).toBe(15);
    expect(state.nodes['widget2'].currentValue).toBe(20);

    graph.destroy();
  });

  /**
   * Test: verify cycle detection in graphs
   */
  test('should detect cycles in graph', () => {
    // Build API detects cycles at creation time during topological sort
    // No cycle - should work fine
    expect(() => {
      createGraph(
        withNodesConfig({
          nodesPlugins: [passthroughPlugin],
          nodes: [
            {
              id: 'A1',
              type: 'passthrough',
              config: { defaultValue: 1 }
            },
            {
              id: 'B1',
              type: 'passthrough',
              inputs: ['A1']
            },
            {
              id: 'A1_cycle',
              type: 'passthrough',
              inputs: ['B1'] // This creates A1 -> B1 -> A1_cycle, but A1_cycle is different node
            }
          ]
        })
      );
    }).not.toThrow(); // No cycle here

    // Actual cycle detection - Build API detects cycles during topological sort
    expect(() => {
      createGraph(
        withNodesConfig({
          nodesPlugins: [passthroughPlugin],
          nodes: [
            {
              id: 'A',
              type: 'passthrough',
              inputs: ['B'] // A depends on B
            },
            {
              id: 'B',
              type: 'passthrough',
              inputs: ['A'] // B depends on A - cycle!
            }
          ]
        })
      );
    }).toThrow(); // Cycle detected during topological sort
  });

  /**
   * Test: verify that we can create complex structures with multiple subgraphs
   */
  test('should support complex structures from multiple subgraphs', async () => {
    const graph = createGraph(
      withNodesConfig({
        nodesPlugins: [passthroughPlugin, aggregatorPlugin],
        nodes: [
          {
            id: 'src1',
            type: 'passthrough',
            config: { defaultValue: 10 }
          },
          {
            id: 'src2',
            type: 'passthrough',
            config: { defaultValue: 20 }
          },
          {
            id: 'src3',
            type: 'passthrough',
            config: { defaultValue: 30 }
          },
          {
            id: 'agg1',
            type: 'aggregator',
            inputs: ['src1', 'src2'],
            config: { mode: 'sum', isSubscribed: true }
          },
          {
            id: 'agg2',
            type: 'aggregator',
            inputs: ['src2', 'src3'],
            config: { mode: 'sum', isSubscribed: true }
          },
          {
            id: 'output',
            type: 'aggregator',
            inputs: ['agg1', 'agg2'],
            config: { mode: 'sum', isSubscribed: true }
          }
        ]
      })
    );

    await graph.execute();
    await new Promise(resolve => setTimeout(resolve, 100));

    // agg1 = 10 + 20 = 30
    // agg2 = 20 + 30 = 50
    // output = 30 + 50 = 80
    let state = graph.exportState();
    expect(state.nodes['agg1'].currentValue).toBe(30);
    expect(state.nodes['agg2'].currentValue).toBe(50);
    expect(state.nodes['output'].currentValue).toBe(80);

    // Update src2, which is used in both aggregators
    const longRunningGraph: LongRunningGraph = graph.run();
    longRunningGraph.updateGraph([
      {
        id: 'src1',
        type: 'passthrough',
        config: { defaultValue: 10 }
      },
      {
        id: 'src2',
        type: 'passthrough',
        config: { defaultValue: 25 }
      },
      {
        id: 'src3',
        type: 'passthrough',
        config: { defaultValue: 30 }
      },
      {
        id: 'agg1',
        type: 'aggregator',
        inputs: ['src1', 'src2'],
        config: { mode: 'sum', isSubscribed: true }
      },
      {
        id: 'agg2',
        type: 'aggregator',
        inputs: ['src2', 'src3'],
        config: { mode: 'sum', isSubscribed: true }
      },
      {
        id: 'output',
        type: 'aggregator',
        inputs: ['agg1', 'agg2'],
        config: { mode: 'sum', isSubscribed: true }
      }
    ], { autoStart: true });

    await new Promise(resolve => setTimeout(resolve, 100));

    // agg1 = 10 + 25 = 35
    // agg2 = 25 + 30 = 55
    // output = 35 + 55 = 90
    state = graph.exportState();
    expect(state.nodes['agg1'].currentValue).toBe(35);
    expect(state.nodes['agg2'].currentValue).toBe(55);
    expect(state.nodes['output'].currentValue).toBe(90);

    graph.destroy();
  });

  /**
   * Test: verify that we can dynamically merge and split subgraphs
   */
  test('should support dynamic merging and splitting of subgraphs', async () => {
    const graph = createGraph(
      withNodesConfig({
        nodesPlugins: [passthroughPlugin, aggregatorPlugin],
        nodes: [
          {
            id: 'data1',
            type: 'passthrough',
            config: { defaultValue: 10 }
          },
          {
            id: 'result1',
            type: 'passthrough',
            inputs: ['data1'],
            config: { isSubscribed: true }
          },
          {
            id: 'data2',
            type: 'passthrough',
            config: { defaultValue: 20 }
          },
          {
            id: 'result2',
            type: 'passthrough',
            inputs: ['data2'],
            config: { isSubscribed: true }
          }
        ]
      })
    );

    await graph.execute();
    await new Promise(resolve => setTimeout(resolve, 100));

    // Check that subgraphs are independent
    let state = graph.exportState();
    expect(state.nodes['result1'].currentValue).toBe(10);
    expect(state.nodes['result2'].currentValue).toBe(20);

    // Merge subgraphs by making result2 depend on result1
    const longRunningGraph: LongRunningGraph = graph.run();
    longRunningGraph.updateGraph([
      {
        id: 'data1',
        type: 'passthrough',
        config: { defaultValue: 10 }
      },
      {
        id: 'result1',
        type: 'passthrough',
        inputs: ['data1'],
        config: { isSubscribed: true }
      },
      {
        id: 'data2',
        type: 'passthrough',
        config: { defaultValue: 20 }
      },
      {
        id: 'result2',
        type: 'aggregator',
        inputs: ['data2', 'result1'],
        config: { mode: 'sum', isSubscribed: true }
      }
    ], { autoStart: true });

    await new Promise(resolve => setTimeout(resolve, 100));

    // Now result2 = data2 + result1 = 20 + 10 = 30
    state = graph.exportState();
    expect(state.nodes['result2'].currentValue).toBe(30);

    // Update data1, this should also affect result2
    longRunningGraph.updateGraph([
      {
        id: 'data1',
        type: 'passthrough',
        config: { defaultValue: 15 }
      },
      {
        id: 'result1',
        type: 'passthrough',
        inputs: ['data1'],
        config: { isSubscribed: true }
      },
      {
        id: 'data2',
        type: 'passthrough',
        config: { defaultValue: 20 }
      },
      {
        id: 'result2',
        type: 'aggregator',
        inputs: ['data2', 'result1'],
        config: { mode: 'sum', isSubscribed: true }
      }
    ], { autoStart: true });

    await new Promise(resolve => setTimeout(resolve, 100));

    // result1 = 15
    // result2 = 20 + 15 = 35
    state = graph.exportState();
    expect(state.nodes['result1'].currentValue).toBe(15);
    expect(state.nodes['result2'].currentValue).toBe(35);

    // Split subgraphs by removing result2 dependency on result1
    longRunningGraph.updateGraph([
      {
        id: 'data1',
        type: 'passthrough',
        config: { defaultValue: 5 }
      },
      {
        id: 'result1',
        type: 'passthrough',
        inputs: ['data1'],
        config: { isSubscribed: true }
      },
      {
        id: 'data2',
        type: 'passthrough',
        config: { defaultValue: 20 }
      },
      {
        id: 'result2',
        type: 'passthrough',
        inputs: ['data2'],
        config: { isSubscribed: true }
      }
    ], { autoStart: true });

    await new Promise(resolve => setTimeout(resolve, 100));

    // Changing data1 no longer affects result2
    state = graph.exportState();
    expect(state.nodes['result1'].currentValue).toBe(5);
    expect(state.nodes['result2'].currentValue).toBe(20); // Remains 20, as it no longer depends on result1

    graph.destroy();
  });

  /**
   * Test: verify dashboard widget simulation
   */
  test('should support dashboard widget scenario', async () => {
    const graph = createGraph(
      withNodesConfig({
        nodesPlugins: [passthroughPlugin, aggregatorPlugin],
        nodes: [
          {
            id: 'temp_data',
            type: 'passthrough',
            config: { defaultValue: 25 }
          },
          {
            id: 'temp_widget',
            type: 'passthrough',
            inputs: ['temp_data'],
            config: { isSubscribed: true }
          },
          {
            id: 'humidity_data',
            type: 'passthrough',
            config: { defaultValue: 60 }
          },
          {
            id: 'humidity_widget',
            type: 'passthrough',
            inputs: ['humidity_data'],
            config: { isSubscribed: true }
          },
          {
            id: 'comfort_index',
            type: 'aggregator',
            inputs: ['temp_data', 'humidity_data'],
            config: { mode: 'avg', isSubscribed: true } // Simplified calculation
          }
        ]
      })
    );

    await graph.execute();
    await new Promise(resolve => setTimeout(resolve, 100));

    // Check that all widgets display correct data
    let state = graph.exportState();
    expect(state.nodes['temp_widget'].currentValue).toBe(25);
    expect(state.nodes['humidity_widget'].currentValue).toBe(60);
    expect(state.nodes['comfort_index'].currentValue).toBe((25 + 60) / 2); // 42.5

    // Update temperature data
    const longRunningGraph: LongRunningGraph = graph.run();
    longRunningGraph.updateGraph([
      {
        id: 'temp_data',
        type: 'passthrough',
        config: { defaultValue: 30 }
      },
      {
        id: 'temp_widget',
        type: 'passthrough',
        inputs: ['temp_data'],
        config: { isSubscribed: true }
      },
      {
        id: 'humidity_data',
        type: 'passthrough',
        config: { defaultValue: 60 }
      },
      {
        id: 'humidity_widget',
        type: 'passthrough',
        inputs: ['humidity_data'],
        config: { isSubscribed: true }
      },
      {
        id: 'comfort_index',
        type: 'aggregator',
        inputs: ['temp_data', 'humidity_data'],
        config: { mode: 'avg', isSubscribed: true }
      }
    ], { autoStart: true });

    await new Promise(resolve => setTimeout(resolve, 100));

    state = graph.exportState();
    expect(state.nodes['temp_widget'].currentValue).toBe(30);
    expect(state.nodes['humidity_widget'].currentValue).toBe(60); // Did not change
    expect(state.nodes['comfort_index'].currentValue).toBe((30 + 60) / 2); // 45

    graph.destroy();
  });
});
