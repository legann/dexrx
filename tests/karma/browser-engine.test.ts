import { createGraph } from '../../lib/dexrx/src/graph';
import { withNodesConfig, withOptions } from '../../lib/dexrx/src/operators';
import { INodePlugin } from 'dexrx';
import { EngineState } from '../../lib/dexrx/src/types/engine-state';

// Create simplest tests to check basic functionality in browser
describe('ReactiveGraphEngine - Browser Environment (Build API)', () => {
  // Simple plugin for tests
  const constantPlugin: INodePlugin = {
    type: 'constant',
    category: 'data',
    compute: (config: any) => config?.value || 42,
  };

  // Check engine creation with basic plugin
  it('should correctly create in browser', () => {
    // Create graph with Build API
    const graph = createGraph(
      withNodesConfig({
        nodesPlugins: [constantPlugin],
        nodes: [
          {
            id: 'test-node',
            type: 'constant',
            config: { value: 42 },
          },
        ],
      })
    );

    // Check that graph is created
    expect(graph).toBeDefined();

    // Start graph (long-running for pause/resume)
    const longRunning = graph.run();

    // Check that graph is in RUNNING state
    expect(graph.getState()).toBe(EngineState.RUNNING);

    // Destroy graph
    graph.destroy();
    expect(graph.getState()).toBe(EngineState.DESTROYED);
  });

  // Check state transitions
  it('should correctly switch states', () => {
    // Create graph with Build API
    const graph = createGraph(
      withNodesConfig({
        nodesPlugins: [constantPlugin],
        nodes: [
          {
            id: 'test-node',
            type: 'constant',
            config: { value: 42 },
          },
        ],
      })
    );

    // Start graph (long-running for pause/resume)
    const longRunning = graph.run();

    // Check initial state
    expect(graph.getState()).toBe(EngineState.RUNNING);

    // Pause
    longRunning.pause();
    expect(graph.getState()).toBe(EngineState.PAUSED);

    // Resume
    longRunning.resume();
    expect(graph.getState()).toBe(EngineState.RUNNING);

    // Destroy
    graph.destroy();
    // After destroy, graph state should be DESTROYED or INITIALIZED (depending on implementation)
    const state = graph.getState();
    expect([EngineState.DESTROYED, EngineState.INITIALIZED]).toContain(state);
  });

  // Check node addition
  it('should add nodes', async () => {
    // Create graph with Build API
    const graph = createGraph(
      withNodesConfig({
        nodesPlugins: [constantPlugin],
        nodes: [
          {
            id: 'test-node',
            type: 'constant',
            config: { value: 42 },
          },
        ],
      })
    );

    // Execute graph
    await graph.execute();

    // Check that node is added (via exportState)
    const state = graph.exportState();
    expect(state.nodes['test-node']).toBeDefined();

    // Destroy graph
    graph.destroy();
  });
});
