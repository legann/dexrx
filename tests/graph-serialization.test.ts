import { createGraph, ExecutableGraph } from '../lib/dexrx/src/graph';
import { withNodesConfig } from '../lib/dexrx/src/operators';
import { INodePlugin } from 'dexrx';

describe('Graph serialization and deserialization (Build API)', () => {
  // Create plugins for testing
  const numberSourcePlugin: INodePlugin = {
    type: 'NumberSource',
    category: 'data',
    compute: (config: any) => config.value || 0
  };
  
  const multiplyPlugin: INodePlugin = {
    type: 'Multiply',
    category: 'operational',
    compute: (config: any, inputs: any[]) => {
      const input = inputs[0] || 0;
      const factor = config.factor || 1;
      return input * factor;
    }
  };
  
  const addPlugin: INodePlugin = {
    type: 'Add',
    category: 'operational',
    compute: (config: any, inputs: any[]) => {
      return inputs.reduce((sum: number, val: any) => sum + (val || 0), 0);
    }
  };

  test('Export empty graph state', () => {
    const graph = createGraph(
      withNodesConfig({
        nodesPlugins: [numberSourcePlugin, multiplyPlugin, addPlugin]
      })
    );
    
    // Export state
    const state = graph.exportState();
    
    // Check structure
    expect(Object.keys(state.nodes).length).toBe(0);
    expect(state.engineId).toBeDefined();
    expect(state.stats.nodesCount).toBe(0);
    
    graph.destroy();
  });

  test('Export graph state with nodes', async () => {
    const graph = createGraph(
      withNodesConfig({
        nodesPlugins: [numberSourcePlugin, multiplyPlugin, addPlugin],
        nodes: [
          {
            id: 'source1',
            type: 'NumberSource',
            config: { value: 10 }
          },
          {
            id: 'source2',
            type: 'NumberSource',
            config: { value: 20 }
          },
          {
            id: 'add',
            type: 'Add',
            inputs: ['source1', 'source2'],
            config: { isSubscribed: true }
          },
          {
            id: 'multiply',
            type: 'Multiply',
            config: { factor: 2, isSubscribed: true },
            inputs: ['add']
          }
        ]
      })
    );

    await graph.execute();
    await new Promise(resolve => setTimeout(resolve, 100));

    // Export state
    const state = graph.exportState();
    
    // Check structure
    expect(Object.keys(state.nodes).length).toBe(4);
    expect(state.stats.nodesCount).toBe(4);
    
    // Check correctness of node export
    const source1 = state.nodes['source1'];
    expect(source1).toBeDefined();
    expect(source1.type).toBe('NumberSource');
    expect(source1.config).toEqual({ value: 10 });
    
    const add = state.nodes['add'];
    expect(add).toBeDefined();
    expect(add.inputs).toContain('source1');
    expect(add.inputs).toContain('source2');
    
    const multiply = state.nodes['multiply'];
    expect(multiply).toBeDefined();
    expect(multiply.config).toEqual({ factor: 2, isSubscribed: true });
    expect(multiply.inputs).toEqual(['add']);

    graph.destroy();
  });

  test('Import state into new graph', async () => {
    // Create source graph
    const graph1 = createGraph(
      withNodesConfig({
        nodesPlugins: [numberSourcePlugin, multiplyPlugin],
        nodes: [
          {
            id: 'source1',
            type: 'NumberSource',
            config: { value: 42 }
          },
          {
            id: 'multiply',
            type: 'Multiply',
            config: { factor: 2, isSubscribed: true },
            inputs: ['source1']
          }
        ]
      })
    );

    await graph1.execute();

    // Export state
    const exportedState = graph1.exportState();
    graph1.destroy();
    
    // Create new graph with same plugins
    const graph2 = createGraph(
      withNodesConfig({
        nodesPlugins: [numberSourcePlugin, multiplyPlugin]
      })
    );
    
    // Import state
    await graph2.importState(exportedState);
    await graph2.execute();

    // Check computation result (42 * 2 = 84)
    const state = graph2.exportState();
    expect(state.nodes['multiply'].currentValue).toBe(84);

    graph2.destroy();
  });

  test('Full export and import cycle', async () => {
    // Create source graph
    const graph1 = createGraph(
      withNodesConfig({
        nodesPlugins: [numberSourcePlugin, addPlugin],
        nodes: [
          {
            id: 'source1',
            type: 'NumberSource',
            config: { value: 10 }
          },
          {
            id: 'source2',
            type: 'NumberSource',
            config: { value: 20 }
          },
          {
            id: 'add',
            type: 'Add',
            inputs: ['source1', 'source2'],
            config: { isSubscribed: true }
          }
        ]
      })
    );

    await graph1.execute();

    // Export state
    const exportedState = graph1.exportState();
    graph1.destroy();
    
    // Create new graph
    const graph2 = createGraph(
      withNodesConfig({
        nodesPlugins: [numberSourcePlugin, addPlugin]
      })
    );
    
    // Import state
    await graph2.importState(exportedState);
    await graph2.execute();

    // Check computation result (10 + 20 = 30)
    const state = graph2.exportState();
    expect(state.nodes['add'].currentValue).toBe(30);

    graph2.destroy();
  });

  test('Import state preserves node values', async () => {
    // Create graph with computed values
    const graph1 = createGraph(
      withNodesConfig({
        nodesPlugins: [numberSourcePlugin, multiplyPlugin],
        nodes: [
          {
            id: 'source1',
            type: 'NumberSource',
            config: { value: 100 }
          },
          {
            id: 'multiply',
            type: 'Multiply',
            config: { factor: 3, isSubscribed: true },
            inputs: ['source1']
          }
        ]
      })
    );

    await graph1.execute();

    // Export state
    const exportedState = graph1.exportState();
    graph1.destroy();
    
    // Create new graph and import state
    const graph2 = createGraph(
      withNodesConfig({
        nodesPlugins: [numberSourcePlugin, multiplyPlugin]
      })
    );
    
    await graph2.importState(exportedState);
    await graph2.execute();

    // Check that values are preserved
    const state = graph2.exportState();
    expect(state.nodes['source1'].currentValue).toBe(100);
    expect(state.nodes['multiply'].currentValue).toBe(300); // 100 * 3

    graph2.destroy();
  });

  test('Import state with complex graph structure', async () => {
    // Create complex graph
    const graph1 = createGraph(
      withNodesConfig({
        nodesPlugins: [numberSourcePlugin, multiplyPlugin, addPlugin],
        nodes: [
          {
            id: 'source1',
            type: 'NumberSource',
            config: { value: 5 }
          },
          {
            id: 'source2',
            type: 'NumberSource',
            config: { value: 10 }
          },
          {
            id: 'add',
            type: 'Add',
            inputs: ['source1', 'source2'],
            config: { isSubscribed: true }
          },
          {
            id: 'multiply',
            type: 'Multiply',
            config: { factor: 2, isSubscribed: true },
            inputs: ['add']
          }
        ]
      })
    );

    await graph1.execute();

    // Export state
    const exportedState = graph1.exportState();
    graph1.destroy();
    
    // Create new graph and import state
    const graph2 = createGraph(
      withNodesConfig({
        nodesPlugins: [numberSourcePlugin, multiplyPlugin, addPlugin]
      })
    );
    
    await graph2.importState(exportedState);
    await graph2.execute();

    // Check computation results
    // add = 5 + 10 = 15
    // multiply = 15 * 2 = 30
    const state = graph2.exportState();
    expect(state.nodes['add'].currentValue).toBe(15);
    expect(state.nodes['multiply'].currentValue).toBe(30);

    graph2.destroy();
  });
});
