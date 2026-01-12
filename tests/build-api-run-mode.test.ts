import { createGraph } from '../lib/dexrx/src/graph';
import { withNodesConfig, withOptions } from '../lib/dexrx/src/operators';
import { DataNodesExecutionMode } from '../lib/dexrx/src/types/engine-options';
import { INodePlugin } from 'dexrx';
import { EngineState } from '../lib/dexrx/src/types/engine-state';

describe('ExecutableGraph.run() - Long-running mode', () => {
  // Simple plugins for testing
  const sourcePlugin: INodePlugin = {
    type: 'source',
    category: 'data',
    compute(config: { value: unknown }) {
      return config.value;
    },
  };

  const addPlugin: INodePlugin = {
    type: 'add',
    category: 'operational',
    compute(_config: unknown, inputs: unknown[]) {
      return (inputs[0] as number) + (inputs[1] as number);
    },
  };

  const mathPlugin: INodePlugin = {
    type: 'math',
    category: 'operational',
    compute(config: { op: string; value?: number }, inputs: unknown[]) {
      const inputValue = (inputs[0] as number) || 0;
      const opValue = config.value || 0;
      switch (config.op) {
        case 'ADD': return inputValue + opValue;
        case 'SUBTRACT': return inputValue - opValue;
        case 'MULTIPLY': return inputValue * opValue;
        case 'DIVIDE': return inputValue / opValue;
        default: return inputValue;
      }
    },
  };

  const dynamicSourcePlugin: INodePlugin = {
    type: 'dynamicSource',
    category: 'data',
    compute(config: { value: unknown; updateValue?: unknown }) {
      // Simulates a node that can be updated (e.g., via webhook or polling)
      return config.updateValue !== undefined ? config.updateValue : config.value;
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Basic run() behavior', () => {
    it('should start graph and leave it running', async () => {
      const graph = createGraph(
        withNodesConfig({
          nodesPlugins: [sourcePlugin, addPlugin],
          nodes: [
            { id: 'a', type: 'source', config: { value: 10 } },
            { id: 'b', type: 'source', config: { value: 20 } },
            { id: 'sum', type: 'add', inputs: ['a', 'b'], config: { isSubscribed: true } },
          ]
        })
      );

      // Run should start the graph
      graph.run();

      // Graph should be running
      expect(graph.getState()).toBe(EngineState.RUNNING);
      expect(graph['isRunning']).toBe(true);
      expect(graph['engine']).not.toBeNull();

      // Graph should not be destroyed
      expect(graph['isDestroyed']).toBe(false);

      // Cleanup
      graph.destroy();
    });

    it('should apply subscriptions automatically when run() is called', async () => {
      const subscriptionHandler = jest.fn();

      const graph = createGraph(
        withNodesConfig({
          nodesPlugins: [sourcePlugin, addPlugin],
          nodes: [
            { id: 'a', type: 'source', config: { value: 10 } },
            { id: 'b', type: 'source', config: { value: 20 } },
            { id: 'sum', type: 'add', inputs: ['a', 'b'], config: { isSubscribed: true } },
          ],
          subscriptions: {
            sum: subscriptionHandler,
          }
        })
      );

      graph.run();

      // Wait a bit for subscriptions to process
      await new Promise(resolve => setTimeout(resolve, 100));

      // Subscription handler should have been called
      expect(subscriptionHandler).toHaveBeenCalled();
      expect(subscriptionHandler).toHaveBeenCalledWith(30, 'sum', 'add');

      // Cleanup
      graph.destroy();
    });

    it('should not wait for result or destroy engine', async () => {
      const graph = createGraph(
        withNodesConfig({
          nodesPlugins: [sourcePlugin, addPlugin],
          nodes: [
            { id: 'a', type: 'source', config: { value: 10 } },
            { id: 'b', type: 'source', config: { value: 20 } },
            { id: 'sum', type: 'add', inputs: ['a', 'b'], config: { isSubscribed: true } },
          ]
        })
      );

      // Engine is created lazily, so it should be null before run()
      expect(graph['engine']).toBeNull();

      graph.run();
      const engineAfter = graph['engine'];

      // Engine should be created and still exist (not destroyed)
      expect(engineAfter).not.toBeNull();

      // Graph should still be running
      expect(graph.getState()).toBe(EngineState.RUNNING);

      // Cleanup
      graph.destroy();
    });
  });

  describe('Long-running behavior with subscriptions', () => {
    it('should emit results through subscription handlers when values change', async () => {
      const subscriptionHandler = jest.fn();

      // Create a graph with a dynamic source that can be updated
      const graph = createGraph(
        withNodesConfig({
          nodesPlugins: [dynamicSourcePlugin, addPlugin],
          nodes: [
            { id: 'source1', type: 'dynamicSource', config: { value: 10 } },
            { id: 'source2', type: 'dynamicSource', config: { value: 20 } },
            { id: 'sum', type: 'add', inputs: ['source1', 'source2'], config: { isSubscribed: true } },
          ],
          subscriptions: {
            sum: subscriptionHandler,
          }
        })
      );

      graph.run();

      // Wait for initial computation
      await new Promise(resolve => setTimeout(resolve, 100));

      // Initial call (may be called multiple times due to INIT_NODE_EXEC filtering)
      expect(subscriptionHandler).toHaveBeenCalled();
      const initialCalls = subscriptionHandler.mock.calls.length;

      // Simulate external trigger (e.g., webhook or polling update)
      // In real scenario, this would be done by the plugin itself
      // Use updateGraph() to update the graph with new node configurations
      const updatedNodes = [
        { id: 'source1', type: 'dynamicSource', config: { value: 15 } },
        { id: 'source2', type: 'dynamicSource', config: { value: 20 } },
        { id: 'sum', type: 'add', inputs: ['source1', 'source2'], config: { isSubscribed: true } },
      ];
      graph.updateGraph(updatedNodes, { autoStart: true });

      // Wait for recalculation
      await new Promise(resolve => setTimeout(resolve, 100));

      // Subscription handler should be called again with new value
      expect(subscriptionHandler.mock.calls.length).toBeGreaterThan(initialCalls);
      // Check that the last call has the new value
      const lastCall = subscriptionHandler.mock.calls[subscriptionHandler.mock.calls.length - 1];
      expect(lastCall[0]).toBe(35); // 15 + 20 = 35
      expect(lastCall[1]).toBe('sum');
      expect(lastCall[2]).toBe('add');

      // Cleanup
      graph.destroy();
    });

    it('should continue running and reacting to multiple updates', async () => {
      const subscriptionHandler = jest.fn();

      const graph = createGraph(
        withNodesConfig({
          nodesPlugins: [dynamicSourcePlugin, addPlugin],
          nodes: [
            { id: 'source1', type: 'dynamicSource', config: { value: 10 } },
            { id: 'source2', type: 'dynamicSource', config: { value: 20 } },
            { id: 'sum', type: 'add', inputs: ['source1', 'source2'], config: { isSubscribed: true } },
          ],
          subscriptions: {
            sum: subscriptionHandler,
          }
        })
      );

      graph.run();

      // Wait for initial computation
      await new Promise(resolve => setTimeout(resolve, 100));

      // Get initial call count
      const initialCalls = subscriptionHandler.mock.calls.length;
      expect(initialCalls).toBeGreaterThan(0);

      // Simulate multiple updates (like polling or webhooks)
      // Use updateGraph() to update the graph with new node configurations
      const updates = [15, 25, 30];
      const expectedValues = [35, 45, 50]; // 15+20, 25+20, 30+20

      for (let i = 0; i < updates.length; i++) {
        const newValue = updates[i];
        const updatedNodes = [
          { id: 'source1', type: 'dynamicSource', config: { value: newValue } },
          { id: 'source2', type: 'dynamicSource', config: { value: 20 } },
          { id: 'sum', type: 'add', inputs: ['source1', 'source2'], config: { isSubscribed: true } },
        ];
        graph.updateGraph(updatedNodes, { autoStart: true });

        // Wait for recalculation
        await new Promise(resolve => setTimeout(resolve, 100));

        // Check that handler was called with expected value
        const callsAfterUpdate = subscriptionHandler.mock.calls;
        const lastCall = callsAfterUpdate[callsAfterUpdate.length - 1];
        expect(lastCall[0]).toBe(expectedValues[i]);
        expect(lastCall[1]).toBe('sum');
        expect(lastCall[2]).toBe('add');
      }

      // Subscription handler should be called at least once for each update
      expect(subscriptionHandler.mock.calls.length).toBeGreaterThanOrEqual(initialCalls + updates.length);

      // Graph should still be running
      expect(graph.getState()).toBe(EngineState.RUNNING);

      // Cleanup
      graph.destroy();
    });
  });

  describe('Comparison with start() + waitForStabilization()', () => {
    it('should behave differently from start() + waitForStabilization()', async () => {
      const subscriptionHandler = jest.fn();

      // Mode 1: start() + waitForStabilization() - one-shot computation
      const graph1 = createGraph(
        withNodesConfig({
          nodesPlugins: [sourcePlugin, addPlugin],
          nodes: [
            { id: 'a', type: 'source', config: { value: 10 } },
            { id: 'b', type: 'source', config: { value: 20 } },
            { id: 'sum', type: 'add', inputs: ['a', 'b'], config: { isSubscribed: true } },
          ],
          subscriptions: {
            sum: subscriptionHandler,
          }
        })
      );

      await graph1.execute({
        timeout: 5000, // Short timeout for test
      });

      // After waitForStabilization, we can get results via exportState
      const state1 = graph1.exportState();
      expect(state1.nodes['sum'].currentValue).toBe(30);

      // Subscription handler should have been called
      expect(subscriptionHandler).toHaveBeenCalledWith(30, 'sum', 'add');

      graph1.destroy();

      // Mode 2: run() - long-running graph
      const subscriptionHandler2 = jest.fn();
      const graph2 = createGraph(
        withNodesConfig({
          nodesPlugins: [sourcePlugin, addPlugin],
          nodes: [
            { id: 'a', type: 'source', config: { value: 10 } },
            { id: 'b', type: 'source', config: { value: 20 } },
            { id: 'sum', type: 'add', inputs: ['a', 'b'], config: { isSubscribed: true } },
          ],
          subscriptions: {
            sum: subscriptionHandler2,
          }
        })
      );

      await graph2.run();

      // Wait a bit for subscriptions to process
      await new Promise(resolve => setTimeout(resolve, 100));

      // Subscription handler should have been called
      expect(subscriptionHandler2).toHaveBeenCalledWith(30, 'sum', 'add');

      // Graph should still be running (not waiting for stabilization)
      expect(graph2.getState()).toBe(EngineState.RUNNING);

      // We can still get state, but graph continues running
      const state2 = graph2.exportState();
      expect(state2.nodes['sum'].currentValue).toBe(30);

      graph2.destroy();
    });
  });

  describe('Error handling', () => {
    it('should throw error if graph is destroyed before run()', async () => {
      const graph = createGraph(
        withNodesConfig({
          nodesPlugins: [sourcePlugin],
          nodes: [
            { id: 'a', type: 'source', config: { value: 10 } },
          ]
        })
      );

      graph.destroy();

      expect(() => graph.run()).toThrow('Graph has been destroyed');
    });

    it('should handle errors in subscription handlers gracefully', async () => {
      const errorHandler = jest.fn(() => {
        throw new Error('Subscription handler error');
      });

      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      const graph = createGraph(
        withNodesConfig({
          nodesPlugins: [sourcePlugin, addPlugin],
          nodes: [
            { id: 'a', type: 'source', config: { value: 10 } },
            { id: 'b', type: 'source', config: { value: 20 } },
            { id: 'sum', type: 'add', inputs: ['a', 'b'], config: { isSubscribed: true } },
          ],
          subscriptions: {
            sum: errorHandler,
          }
        })
      );

      graph.run();

      // Wait for subscription to process
      await new Promise(resolve => setTimeout(resolve, 100));

      // Error should be logged but graph should continue running
      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(graph.getState()).toBe(EngineState.RUNNING);

      consoleErrorSpy.mockRestore();
      graph.destroy();
    });
  });

  describe('Multiple subscribed nodes', () => {
    it('should handle multiple subscribed nodes with different handlers', async () => {
      const handler1 = jest.fn();
      const handler2 = jest.fn();

      const graph = createGraph(
        withNodesConfig({
          nodesPlugins: [sourcePlugin, addPlugin],
          nodes: [
            { id: 'a', type: 'source', config: { value: 10 } },
            { id: 'b', type: 'source', config: { value: 20 } },
            { id: 'sum', type: 'add', inputs: ['a', 'b'], config: { isSubscribed: true } },
            { id: 'product', type: 'add', inputs: ['a', 'b'], config: { isSubscribed: true } },
          ],
          subscriptions: {
            sum: handler1,
            product: handler2,
          }
        })
      );

      graph.run();

      // Wait for subscriptions to process
      await new Promise(resolve => setTimeout(resolve, 100));

      // Both handlers should be called
      expect(handler1).toHaveBeenCalledWith(30, 'sum', 'add');
      expect(handler2).toHaveBeenCalledWith(30, 'product', 'add');

      graph.destroy();
    });
  });

  describe('Integration with options', () => {
    it('should work with withOptions', async () => {
      const subscriptionHandler = jest.fn();

      const graph = createGraph(
        withOptions({
          engine: {
            dataNodesExecutionMode: DataNodesExecutionMode.SYNC_EXEC_MODE,
            debounceTime: 10,
          },
          runtimeContext: (nodeId, nodeType) => ({
            nodeId,
            workUnitId: 'work-123',
            category: nodeType === 'source' ? 'data' : 'operational',
          }),
        }),
        withNodesConfig({
          nodesPlugins: [sourcePlugin, addPlugin],
          nodes: [
            { id: 'a', type: 'source', config: { value: 10 } },
            { id: 'b', type: 'source', config: { value: 20 } },
            { id: 'sum', type: 'add', inputs: ['a', 'b'], config: { isSubscribed: true } },
          ],
          subscriptions: {
            sum: subscriptionHandler,
          }
        })
      );

      graph.run();

      // Wait for subscriptions to process
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(subscriptionHandler).toHaveBeenCalled();
      expect(graph.getState()).toBe(EngineState.RUNNING);

      graph.destroy();
    });
  });

  describe('updateNode() - Update single node config/data', () => {
    it('should update node config without recreating graph', async () => {
      const subscriptionHandler = jest.fn();

      const graph = createGraph(
        withNodesConfig({
          nodesPlugins: [sourcePlugin, addPlugin],
          nodes: [
            { id: 'a', type: 'source', config: { value: 10 } },
            { id: 'b', type: 'source', config: { value: 20 } },
            { id: 'sum', type: 'add', inputs: ['a', 'b'], config: { isSubscribed: true } },
          ],
          subscriptions: {
            sum: subscriptionHandler,
          }
        })
      );

      const longRunning = graph.run();

      // Wait for initial computation
      await new Promise(resolve => setTimeout(resolve, 100));

      // Get initial state
      const engineBefore = graph['engine'];
      const initialState = graph.exportState();
      expect(initialState.nodes['sum'].currentValue).toBe(30);

      // Clear handler calls
      subscriptionHandler.mockClear();

      // Update only node 'a' with new value (preserves graph structure)
      longRunning.updateNode('a', {
        id: 'a',
        type: 'source',
        config: { value: 15 }
      });

      // Wait for recalculation
      await new Promise(resolve => setTimeout(resolve, 100));

      // Engine should be the same instance (not recreated)
      expect(graph['engine']).toBe(engineBefore);

      // Graph should still be running
      expect(graph.getState()).toBe(EngineState.RUNNING);

      // New value should be calculated (15 + 20 = 35)
      const updatedState = graph.exportState();
      expect(updatedState.nodes['sum'].currentValue).toBe(35);

      // Subscription handler should be called with new value
      expect(subscriptionHandler).toHaveBeenCalledWith(35, 'sum', 'add');

      graph.destroy();
    });

    it('should automatically recalculate dependent nodes', async () => {
      const subscriptionHandler = jest.fn();

      const graph = createGraph(
        withNodesConfig({
          nodesPlugins: [sourcePlugin, addPlugin],
          nodes: [
            { id: 'a', type: 'source', config: { value: 10 } },
            { id: 'b', type: 'source', config: { value: 20 } },
            { id: 'sum1', type: 'add', inputs: ['a', 'b'], config: { isSubscribed: true } },
            { id: 'sum2', type: 'add', inputs: ['sum1', 'b'], config: { isSubscribed: true } },
          ],
          subscriptions: {
            sum1: subscriptionHandler,
            sum2: subscriptionHandler,
          }
        })
      );

      const longRunning = graph.run();

      // Wait for initial computation
      await new Promise(resolve => setTimeout(resolve, 100));

      // Initial values: sum1 = 30, sum2 = 50
      let state = graph.exportState();
      expect(state.nodes['sum1'].currentValue).toBe(30);
      expect(state.nodes['sum2'].currentValue).toBe(50);

      subscriptionHandler.mockClear();

      // Update node 'a' - both sum1 and sum2 should recalculate
      longRunning.updateNode('a', {
        id: 'a',
        type: 'source',
        config: { value: 15 }
      });

      // Wait for recalculation
      await new Promise(resolve => setTimeout(resolve, 100));

      // New values: sum1 = 35 (15+20), sum2 = 55 (35+20)
      state = graph.exportState();
      expect(state.nodes['sum1'].currentValue).toBe(35);
      expect(state.nodes['sum2'].currentValue).toBe(55);

      // Both handlers should be called
      expect(subscriptionHandler).toHaveBeenCalledWith(35, 'sum1', 'add');
      expect(subscriptionHandler).toHaveBeenCalledWith(55, 'sum2', 'add');

      graph.destroy();
    });

    it('should work with webhook-like scenario', async () => {
      const webhookPlugin: INodePlugin = {
        type: 'webhook',
        category: 'data',
        compute: (config: { data?: any }) => {
          return config.data || null;
        },
      };

      const subscriptionHandler = jest.fn();

      const graph = createGraph(
        withNodesConfig({
          nodesPlugins: [webhookPlugin, addPlugin],
          nodes: [
            { id: 'webhook1', type: 'webhook', config: { data: null, isSubscribed: true } },
            { id: 'math1', type: 'add', inputs: ['webhook1'], config: { isSubscribed: true } },
          ],
          subscriptions: {
            webhook1: subscriptionHandler,
            math1: subscriptionHandler,
          }
        })
      );

      const longRunning = graph.run();

      // Wait for initial computation
      await new Promise(resolve => setTimeout(resolve, 100));

      subscriptionHandler.mockClear();

      // Simulate webhook receiving data
      longRunning.updateNode('webhook1', {
        id: 'webhook1',
        type: 'webhook',
        config: { data: { value: 42 }, isSubscribed: true }
      });

      // Wait for recalculation
      await new Promise(resolve => setTimeout(resolve, 100));

      // Webhook node should have new data
      const state = graph.exportState();
      expect(state.nodes['webhook1'].currentValue).toEqual({ value: 42 });

      // Math node should recalculate (though add plugin expects numbers, this tests the flow)
      expect(subscriptionHandler).toHaveBeenCalled();

      graph.destroy();
    });

    it('should throw error if node type changes', async () => {
      const graph = createGraph(
        withNodesConfig({
          nodesPlugins: [sourcePlugin, addPlugin],
          nodes: [
            { id: 'a', type: 'source', config: { value: 10 } },
          ]
        })
      );

      const longRunning = graph.run();
      await new Promise(resolve => setTimeout(resolve, 50));

      // Try to change node type - should throw error
      expect(() => {
        longRunning.updateNode('a', {
          id: 'a',
          type: 'add', // Wrong type!
          config: { value: 20 }
        });
      }).toThrow('Cannot change node type');

      graph.destroy();
    });

    it('should throw error if node not found', async () => {
      const graph = createGraph(
        withNodesConfig({
          nodesPlugins: [sourcePlugin],
          nodes: [
            { id: 'a', type: 'source', config: { value: 10 } },
          ]
        })
      );

      const longRunning = graph.run();
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(() => {
        longRunning.updateNode('nonexistent', {
          id: 'nonexistent',
          type: 'source',
          config: { value: 20 }
        });
      }).toThrow("Node 'nonexistent' not found in graph");

      graph.destroy();
    });

    it('should throw error if not in long-running mode', async () => {
      const graph = createGraph(
        withNodesConfig({
          nodesPlugins: [sourcePlugin],
          nodes: [
            { id: 'a', type: 'source', config: { value: 10 } },
          ]
        })
      );

      // Don't call run() - graph is not in long-running mode
      expect(() => {
        graph.updateNode('a', {
          id: 'a',
          type: 'source',
          config: { value: 20 }
        });
      }).toThrow('updateNode() is only available for long-running graphs');

      graph.destroy();
    });

    it('should throw error if called after execute()', async () => {
      const graph = createGraph(
        withNodesConfig({
          nodesPlugins: [sourcePlugin],
          nodes: [
            { id: 'a', type: 'source', config: { value: 10 } },
          ]
        })
      );

      // Execute graph (single execution mode)
      await graph.execute();

      // After execute(), graph is not in long-running mode
      expect(() => {
        graph.updateNode('a', {
          id: 'a',
          type: 'source',
          config: { value: 20 }
        });
      }).toThrow('updateNode() is only available for long-running graphs');

      graph.destroy();
    });

    it('should update operational node (not data node) and recalculate', async () => {
      const subscriptionHandler = jest.fn();

      const graph = createGraph(
        withNodesConfig({
          nodesPlugins: [sourcePlugin, mathPlugin],
          nodes: [
            { id: 'source1', type: 'source', config: { value: 10 } },
            { id: 'math1', type: 'math', inputs: ['source1'], config: { op: 'ADD', value: 5, isSubscribed: true } },
          ],
          subscriptions: {
            math1: subscriptionHandler,
          }
        })
      );

      const longRunning = graph.run();

      // Wait for initial computation
      await new Promise(resolve => setTimeout(resolve, 100));

      // Initial value: 10 + 5 = 15
      let state = graph.exportState();
      expect(state.nodes['math1'].currentValue).toBe(15);
      expect(subscriptionHandler).toHaveBeenCalledWith(15, 'math1', 'math');

      subscriptionHandler.mockClear();

      // Update operational node: change operation from ADD to MULTIPLY
      longRunning.updateNode('math1', {
        id: 'math1',
        type: 'math',
        inputs: ['source1'],
        config: { op: 'MULTIPLY', value: 3, isSubscribed: true }
      });

      // Wait for recalculation
      await new Promise(resolve => setTimeout(resolve, 100));

      // New value: 10 * 3 = 30
      state = graph.exportState();
      expect(state.nodes['math1'].currentValue).toBe(30);
      expect(subscriptionHandler).toHaveBeenCalledWith(30, 'math1', 'math');

      // Engine should still be the same instance (not recreated)
      expect(graph['engine']).not.toBeNull();
      expect(graph.getState()).toBe(EngineState.RUNNING);

      graph.destroy();
    });

    it('should update operational node config and preserve reactivity', async () => {
      const subscriptionHandler = jest.fn();

      const graph = createGraph(
        withNodesConfig({
          nodesPlugins: [sourcePlugin, mathPlugin],
          nodes: [
            { id: 'source1', type: 'source', config: { value: 10 } },
            { id: 'math1', type: 'math', inputs: ['source1'], config: { op: 'ADD', value: 2, isSubscribed: true } },
            { id: 'math2', type: 'math', inputs: ['math1'], config: { op: 'MULTIPLY', value: 2, isSubscribed: true } },
          ],
          subscriptions: {
            math1: subscriptionHandler,
            math2: subscriptionHandler,
          }
        })
      );

      const longRunning = graph.run();

      // Wait for initial computation
      await new Promise(resolve => setTimeout(resolve, 100));

      // Initial values: math1 = 10 + 2 = 12, math2 = 12 * 2 = 24
      let state = graph.exportState();
      expect(state.nodes['math1'].currentValue).toBe(12);
      expect(state.nodes['math2'].currentValue).toBe(24);

      subscriptionHandler.mockClear();

      // Update first operational node: change value from 2 to 5
      longRunning.updateNode('math1', {
        id: 'math1',
        type: 'math',
        inputs: ['source1'],
        config: { op: 'ADD', value: 5, isSubscribed: true }
      });

      // Wait for recalculation
      await new Promise(resolve => setTimeout(resolve, 100));

      // New values: math1 = 10 + 5 = 15, math2 = 15 * 2 = 30
      state = graph.exportState();
      expect(state.nodes['math1'].currentValue).toBe(15);
      expect(state.nodes['math2'].currentValue).toBe(30);

      // Both handlers should be called (math1 and math2 recalculated)
      expect(subscriptionHandler).toHaveBeenCalledWith(15, 'math1', 'math');
      expect(subscriptionHandler).toHaveBeenCalledWith(30, 'math2', 'math');

      graph.destroy();
    });
  });

  describe('updateGraph() - Error handling in execute() mode', () => {
    it('should throw error if called before run()', () => {
      const graph = createGraph(
        withNodesConfig({
          nodesPlugins: [sourcePlugin],
          nodes: [
            { id: 'a', type: 'source', config: { value: 10 } },
          ]
        })
      );

      // Don't call run() - graph is not in long-running mode
      expect(() => {
        graph.updateGraph([
          { id: 'a', type: 'source', config: { value: 20 } }
        ]);
      }).toThrow('updateGraph() is only available for long-running graphs');

      graph.destroy();
    });

    it('should throw error if called after execute()', async () => {
      const graph = createGraph(
        withNodesConfig({
          nodesPlugins: [sourcePlugin],
          nodes: [
            { id: 'a', type: 'source', config: { value: 10 } },
          ]
        })
      );

      // Execute graph (single execution mode)
      await graph.execute();

      // After execute(), graph is not in long-running mode
      expect(() => {
        graph.updateGraph([
          { id: 'a', type: 'source', config: { value: 20 } }
        ]);
      }).toThrow('updateGraph() is only available for long-running graphs');

      graph.destroy();
    });

    it('should throw error if called after execute() completes', async () => {
      const graph = createGraph(
        withNodesConfig({
          nodesPlugins: [sourcePlugin, addPlugin],
          nodes: [
            { id: 'a', type: 'source', config: { value: 10 } },
            { id: 'b', type: 'source', config: { value: 20 } },
            { id: 'sum', type: 'add', inputs: ['a', 'b'], config: {} },
          ]
        })
      );

      // Execute graph and wait for completion
      await graph.execute();
      
      // Wait a bit to ensure graph has stabilized
      await new Promise(resolve => setTimeout(resolve, 100));

      // After execute() completes, graph should not be in long-running mode
      expect(() => {
        graph.updateGraph([
          { id: 'a', type: 'source', config: { value: 15 } },
          { id: 'b', type: 'source', config: { value: 20 } },
          { id: 'sum', type: 'add', inputs: ['a', 'b'], config: {} },
        ]);
      }).toThrow('updateGraph() is only available for long-running graphs');

      graph.destroy();
    });
  });

  describe('One data node feeding multiple operational nodes', () => {
    // Plugin for finding maximum value
    const maxPlugin: INodePlugin = {
      type: 'max',
      category: 'operational',
      compute(_config: unknown, inputs: unknown[]) {
        // Handle array input
        if (inputs.length > 0 && Array.isArray(inputs[0])) {
          const arr = inputs[0] as number[];
          return arr.length > 0 ? Math.max(...arr) : 0;
        }
        // Handle number inputs
        const values = inputs.filter(v => typeof v === 'number') as number[];
        return values.length > 0 ? Math.max(...values) : 0;
      },
    };

    // Plugin for multiplying value
    const multiplyPlugin: INodePlugin = {
      type: 'multiply',
      category: 'operational',
      compute(config: { factor?: number }, inputs: unknown[]) {
        // Handle array input - multiply each element
        if (inputs.length > 0 && Array.isArray(inputs[0])) {
          const arr = inputs[0] as number[];
          const factor = config.factor || 1;
          return arr.map(v => v * factor);
        }
        // Handle number input
        const inputValue = (inputs[0] as number) || 0;
        const factor = config.factor || 1;
        return inputValue * factor;
      },
    };

    // Plugin for summing array of numbers
    const sumPlugin: INodePlugin = {
      type: 'sum',
      category: 'operational',
      compute(_config: unknown, inputs: unknown[]) {
        // Sum all inputs - handle both numbers and arrays
        let total = 0;
        for (const input of inputs) {
          if (typeof input === 'number') {
            total += input;
          } else if (Array.isArray(input)) {
            // Sum array elements
            total += (input as number[]).reduce((acc, val) => acc + (typeof val === 'number' ? val : 0), 0);
          }
        }
        return total;
      },
    };

    it('should handle one data node feeding multiple operational nodes, then root node sums results', async () => {
      const subscriptionHandler = jest.fn();

      const graph = createGraph(
        withNodesConfig({
          nodesPlugins: [sourcePlugin, maxPlugin, multiplyPlugin, sumPlugin],
          nodes: [
            // Data node - source of data
            { id: 'source1', type: 'source', config: { value: [10, 20, 30, 40, 50] } },
            
            // Operational node 1: finds max from array
            { id: 'max1', type: 'max', inputs: ['source1'], config: { isSubscribed: true } },
            
            // Operational node 2: multiplies by factor
            { id: 'multiply1', type: 'multiply', inputs: ['source1'], config: { factor: 2, isSubscribed: true } },
            
            // Root operational node: sums results from both operational nodes
            { id: 'sum', type: 'sum', inputs: ['max1', 'multiply1'], config: { isSubscribed: true } },
          ],
          subscriptions: {
            max1: subscriptionHandler,
            multiply1: subscriptionHandler,
            sum: subscriptionHandler,
          }
        })
      );

      const longRunning = graph.run();
      await new Promise(resolve => setTimeout(resolve, 100)); // Wait for initial computation

      // Check initial state
      let state = graph.exportState();
      
      // source1 should have array [10, 20, 30, 40, 50]
      expect(state.nodes['source1'].currentValue).toEqual([10, 20, 30, 40, 50]);
      
      // max1 should find max from array = 50
      expect(state.nodes['max1'].currentValue).toBe(50);
      
      // multiply1 should multiply each element by 2 = [20, 40, 60, 80, 100]
      expect(state.nodes['multiply1'].currentValue).toEqual([20, 40, 60, 80, 100]);
      
      // sum should sum both results: max1 (50) + sum of multiply1 array (20+40+60+80+100 = 300) = 350
      expect(state.nodes['sum'].currentValue).toBe(350);
      
      // Verify subscriptions were called for all nodes
      expect(subscriptionHandler).toHaveBeenCalledWith(50, 'max1', 'max');
      expect(subscriptionHandler).toHaveBeenCalledWith([20, 40, 60, 80, 100], 'multiply1', 'multiply');
      expect(subscriptionHandler).toHaveBeenCalledWith(350, 'sum', 'sum');
      
      // Verify graph structure is correct (no cycles - valid DAG)
      expect(state.nodes['source1']).toBeDefined();
      expect(state.nodes['max1']).toBeDefined();
      expect(state.nodes['multiply1']).toBeDefined();
      expect(state.nodes['sum']).toBeDefined();

      graph.destroy();
    });

    it('should correctly handle one data node (number) feeding multiple operational nodes, then root sums results', async () => {
      const subscriptionHandler = jest.fn();

      const graph = createGraph(
        withNodesConfig({
          nodesPlugins: [sourcePlugin, maxPlugin, multiplyPlugin, sumPlugin],
          nodes: [
            // Data node - single number value
            { id: 'source1', type: 'source', config: { value: 100 } },
            
            // Operational node 1: finds max (will just return the number)
            { id: 'max1', type: 'max', inputs: ['source1'], config: { isSubscribed: true } },
            
            // Operational node 2: multiplies by factor
            { id: 'multiply1', type: 'multiply', inputs: ['source1'], config: { factor: 3, isSubscribed: true } },
            
            // Root operational node: sums results from both operational nodes
            { id: 'sum', type: 'sum', inputs: ['max1', 'multiply1'], config: { isSubscribed: true } },
          ],
          subscriptions: {
            max1: subscriptionHandler,
            multiply1: subscriptionHandler,
            sum: subscriptionHandler,
          }
        })
      );

      const longRunning = graph.run();
      await new Promise(resolve => setTimeout(resolve, 100)); // Wait for initial computation

      // Check initial state
      let state = graph.exportState();
      
      // source1 should have value 100
      expect(state.nodes['source1'].currentValue).toBe(100);
      
      // max1 should return 100 (max of single number)
      expect(state.nodes['max1'].currentValue).toBe(100);
      
      // multiply1 should return 100 * 3 = 300
      expect(state.nodes['multiply1'].currentValue).toBe(300);
      
      // sum should be: max1 (100) + multiply1 (300) = 400
      expect(state.nodes['sum'].currentValue).toBe(400);
      
      // Verify subscriptions were called for all nodes
      expect(subscriptionHandler).toHaveBeenCalledWith(100, 'max1', 'max');
      expect(subscriptionHandler).toHaveBeenCalledWith(300, 'multiply1', 'multiply');
      expect(subscriptionHandler).toHaveBeenCalledWith(400, 'sum', 'sum');

      // Update source node and verify all dependent nodes recalculate
      subscriptionHandler.mockClear();
      
      longRunning.updateNode('source1', {
        id: 'source1',
        type: 'source',
        config: { value: 200 }
      });
      
      await new Promise(resolve => setTimeout(resolve, 100)); // Wait for recalculation

      state = graph.exportState();
      
      // source1 should have new value 200
      expect(state.nodes['source1'].currentValue).toBe(200);
      
      // max1 should return 200
      expect(state.nodes['max1'].currentValue).toBe(200);
      
      // multiply1 should return 200 * 3 = 600
      expect(state.nodes['multiply1'].currentValue).toBe(600);
      
      // sum should be: max1 (200) + multiply1 (600) = 800
      expect(state.nodes['sum'].currentValue).toBe(800);
      
      // Verify subscriptions were called again with new values
      expect(subscriptionHandler).toHaveBeenCalledWith(200, 'max1', 'max');
      expect(subscriptionHandler).toHaveBeenCalledWith(600, 'multiply1', 'multiply');
      expect(subscriptionHandler).toHaveBeenCalledWith(800, 'sum', 'sum');

      graph.destroy();
    });
  });
});

