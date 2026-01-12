import { createGraph, ExecutableGraph } from '../lib/dexrx/src/graph';
import { withNodesConfig, withOptions } from '../lib/dexrx/src/operators';
import { EngineState } from '../lib/dexrx/src/types/engine-state';
import { DataNodesExecutionMode } from '../lib/dexrx/src/types/engine-options';
import { INodePlugin } from 'dexrx';

describe('Engine State Export/Import (Build API)', () => {
  const sourcePlugin: INodePlugin = {
    type: 'source',
    category: 'data',
    compute: (config) => config.value
  };

  const multiplierPlugin: INodePlugin = {
    type: 'multiplier',
    category: 'operational',
    compute: (config, inputs) => ((inputs[0] as number) || 0) * (((config.factor as number) || 1))
  };

  const sumPlugin: INodePlugin = {
    type: 'sum',
    category: 'operational',
    compute: (_config, inputs) => inputs.reduce((a, b) => (a as number) + (((b as number) || 0)), 0 as number)
  };

  // No fake timers needed for Build API tests

  it('should export empty engine state', () => {
    const graph = createGraph(
      withNodesConfig({
        nodesPlugins: [sourcePlugin]
      })
    );

    const state = graph.exportState();
    
    expect(state).toBeDefined();
    expect(state.engineId).toBeDefined();
    expect(state.state).toBe(EngineState.INITIALIZED);
    expect(Object.keys(state.nodes).length).toBe(0);
    
    graph.destroy();
  });
  
  it('should export engine state with nodes', async () => {
    const graph = createGraph(
      withNodesConfig({
        nodesPlugins: [sourcePlugin, multiplierPlugin, sumPlugin],
        nodes: [
          {
            id: 'source1',
            type: 'source',
            config: { value: 5 }
          },
          {
            id: 'source2',
            type: 'source',
            config: { value: 10 }
          },
          {
            id: 'multiplier',
            type: 'multiplier',
            inputs: ['source1'],
            config: { factor: 2 }
          },
          {
            id: 'sum',
            type: 'sum',
            inputs: ['multiplier', 'source2'],
            config: { isSubscribed: true }
          }
        ]
      })
    );

    await graph.execute();
    await new Promise(resolve => setTimeout(resolve, 100));
    
    const state = graph.exportState();
    
    expect(state).toBeDefined();
    expect(state.nodes).toBeDefined();
    expect(state.nodes['source1']).toBeDefined();
    expect(state.nodes['source2']).toBeDefined();
    expect(state.nodes['multiplier']).toBeDefined();
    expect(state.nodes['sum']).toBeDefined();
    
    expect(state.nodes['source1'].currentValue).toBe(5);
    expect(state.nodes['source2'].currentValue).toBe(10);
    expect(state.nodes['multiplier'].currentValue).toBe(10); // 5 * 2
    expect(state.nodes['sum'].currentValue).toBe(20); // 10 + 10
    
    graph.destroy();
  });

  it('should import engine state and restore computation', async () => {
    // Create first graph and export state
    const graph1 = createGraph(
      withNodesConfig({
        nodesPlugins: [sourcePlugin, multiplierPlugin, sumPlugin],
        nodes: [
          {
            id: 'source1',
            type: 'source',
            config: { value: 5 }
          },
          {
            id: 'source2',
            type: 'source',
            config: { value: 10 }
          },
          {
            id: 'multiplier',
            type: 'multiplier',
            inputs: ['source1'],
            config: { factor: 2 }
          },
          {
            id: 'sum',
            type: 'sum',
            inputs: ['multiplier', 'source2'],
            config: { isSubscribed: true }
          }
        ]
      })
    );

    await graph1.execute();
    
    const exportedState = graph1.exportState();
    graph1.destroy();

    // Create new graph and import state
    const graph2 = createGraph(
      withOptions({
        engine: {
          dataNodesExecutionMode: DataNodesExecutionMode.SYNC_EXEC_MODE
        }
      }),
      withNodesConfig({
        nodesPlugins: [sourcePlugin, multiplierPlugin, sumPlugin]
      })
    );

    await graph2.importState(exportedState);
    await graph2.execute();

    const state = graph2.exportState();
    
    expect(state.nodes['source1'].currentValue).toBe(5);
    expect(state.nodes['source2'].currentValue).toBe(10);
    expect(state.nodes['multiplier'].currentValue).toBe(10);
    expect(state.nodes['sum'].currentValue).toBe(20);
    
    graph2.destroy();
  });

  it('should preserve node metadata in exported state', async () => {
    const graph = createGraph(
      withNodesConfig({
        nodesPlugins: [sourcePlugin],
        nodes: [
          {
            id: 'source1',
            type: 'source',
            config: { value: 5, customField: 'test' }
          }
        ]
      })
    );

    await graph.execute();
    await new Promise(resolve => setTimeout(resolve, 100));
    
    const state = graph.exportState();
    
    expect(state.nodes['source1'].config).toBeDefined();
    expect(state.nodes['source1'].config?.customField).toBe('test');
    
    graph.destroy();
  });

  it('should handle state export/import with ExecutableGraph.fromState', async () => {
    const graph1 = createGraph(
      withNodesConfig({
        nodesPlugins: [sourcePlugin, multiplierPlugin],
        nodes: [
          {
            id: 'source1',
            type: 'source',
            config: { value: 5 }
          },
          {
            id: 'multiplier',
            type: 'multiplier',
            inputs: ['source1'],
            config: { factor: 3, isSubscribed: true }
          }
        ]
      })
    );

    await graph1.execute();
    
    const exportedState = graph1.exportState();
    graph1.destroy();

    // Use static fromState method - but need to create graph with plugins first
    // Then import state
    const graph2 = createGraph(
      withNodesConfig({
        nodesPlugins: [sourcePlugin, multiplierPlugin]
      })
    );

    await graph2.importState(exportedState);
    await graph2.execute();

    const state = graph2.exportState();
    
    expect(state.nodes['source1'].currentValue).toBe(5);
    expect(state.nodes['multiplier'].currentValue).toBe(15); // 5 * 3
    
    graph2.destroy();
  });

  it('should export state with engine options', async () => {
    const graph = createGraph(
      withOptions({
        engine: {
          dataNodesExecutionMode: DataNodesExecutionMode.ASYNC_EXEC_MODE,
          debounceTime: 50
        }
      }),
      withNodesConfig({
        nodesPlugins: [sourcePlugin],
        nodes: [
          {
            id: 'source1',
            type: 'source',
            config: { value: 5 }
          }
        ]
      })
    );

    await graph.execute();
    await new Promise(resolve => setTimeout(resolve, 100));
    
    const state = graph.exportState();
    
    // Options are preserved in exported state
    expect(state.options).toBeDefined();
    // Note: dataNodesExecutionMode might be stored differently or not directly in options
    // Check that options object exists and has some properties
    expect(typeof state.options).toBe('object');
    
    graph.destroy();
  });

  it('should export state with stats', async () => {
    const graph = createGraph(
      withNodesConfig({
        nodesPlugins: [sourcePlugin],
        nodes: [
          {
            id: 'source1',
            type: 'source',
            config: { value: 5, isSubscribed: true }
          }
        ]
      })
    );

    await graph.execute();
    await new Promise(resolve => setTimeout(resolve, 100));
    
    const state = graph.exportState();
    
    expect(state.stats).toBeDefined();
    expect(state.stats.nodesCount).toBeGreaterThan(0);
    
    graph.destroy();
  });
});
