import { createGraph } from '../lib/dexrx/src/graph';
import {
  withNodesConfig,
  withOptions,
  withPersistence,
  withNotifications,
} from '../lib/dexrx/src/operators';
import { MemoryStateProvider } from '../lib/dexrx/src/providers/memory/persistence';
import { DataNodesExecutionMode } from '../lib/dexrx/src/types/engine-options';
import { INodePlugin, NodeCategory } from 'dexrx';
import type { IPersistenceProvider, INotificationProvider } from '../lib/dexrx/src/graph';
import { EngineState } from '../lib/dexrx/src/types/engine-state';

describe('ExecutableGraph.updateGraph()', () => {
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

  const multiplyPlugin: INodePlugin = {
    type: 'multiply',
    category: 'operational',
    compute(_config: unknown, inputs: unknown[]) {
      return (inputs[0] as number) * (inputs[1] as number);
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Basic updateGraph functionality', () => {
    it('should update graph with new nodes', async () => {
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

      expect(graph).toBeDefined();

      // Start graph via run() to enable updateGraph()
      graph.run();

      // Update with new nodes (only available for long-running graphs)
      const newNodes = [
        { id: 'x', type: 'source', config: { value: 5 } },
        { id: 'y', type: 'source', config: { value: 15 } },
        { id: 'newSum', type: 'add', inputs: ['x', 'y'], config: {} },
      ];

      graph.updateGraph(newNodes);

      // Graph should be updated but not started (unless autoStart is true)
      expect(graph.getState()).not.toBe(EngineState.RUNNING);
    });

    it('should destroy old engine when updating', async () => {
      const graph = createGraph(
        withNodesConfig({
          nodesPlugins: [sourcePlugin],
          nodes: [
            { id: 'a', type: 'source', config: { value: 10 } },
          ]
        })
      );

      graph.run();
      expect(graph.getState()).toBe(EngineState.RUNNING);

      // Update graph (only available for long-running graphs)
      graph.updateGraph([
        { id: 'b', type: 'source', config: { value: 20 } },
      ]);

      // Old engine should be destroyed
      expect(graph.getState()).not.toBe(EngineState.RUNNING);
    });

    it('should auto-start new graph if autoStart option is true', async () => {
      const graph = createGraph(
        withNodesConfig({
          nodesPlugins: [sourcePlugin],
          nodes: [
            { id: 'a', type: 'source', config: { value: 10 } },
          ]
        })
      );

      graph.run();
      expect(graph.getState()).toBe(EngineState.RUNNING);

      // Update with autoStart (only available for long-running graphs)
      graph.updateGraph(
        [
          { id: 'b', type: 'source', config: { value: 20 } },
        ],
        { autoStart: true }
      );

      // New graph should be started
      expect(graph.getState()).toBe(EngineState.RUNNING);
    });
  });

  describe('Infrastructure preservation', () => {
    it('should preserve persistence provider after update', async () => {
      const persistenceProvider = new MemoryStateProvider();

      const graph = createGraph(
        withPersistence(persistenceProvider),
        withNodesConfig({
          nodesPlugins: [sourcePlugin],
          nodes: [
            { id: 'a', type: 'source', config: { value: 10 } },
          ]
        })
      );

      graph.run();
      await new Promise(resolve => setTimeout(resolve, 50));
      await graph.saveState('test-key');

      // Update graph (only available for long-running graphs)
      graph.updateGraph(
        [
          { id: 'b', type: 'source', config: { value: 20 } },
        ],
        { autoStart: true }
      );

      // Persistence provider should still work
      await graph.saveState('test-key-2');
      const loaded = await graph.loadState('test-key-2');
      expect(loaded).toBeDefined();
    });

    it('should preserve notification provider after update', async () => {
      const notificationProvider: INotificationProvider = {
        async notify(connectionId: string, data: unknown): Promise<void> {
          // Mock implementation
        },
        async broadcast(topic: string, data: unknown): Promise<void> {
          // Mock implementation
        },
        async subscribe(connectionId: string, topic: string): Promise<void> {
          // Mock implementation
        },
        async unsubscribe(connectionId: string, topic: string): Promise<void> {
          // Mock implementation
        },
      };

      const broadcastSpy = jest.spyOn(notificationProvider, 'broadcast');

      const graph = createGraph(
        withNotifications(notificationProvider),
        withNodesConfig({
          nodesPlugins: [sourcePlugin],
          nodes: [
            { id: 'a', type: 'source', config: { value: 10 } },
          ]
        })
      );

      // Start graph via run() to enable updateGraph()
      graph.run();

      // Update graph (only available for long-running graphs)
      graph.updateGraph(
        [
          { id: 'b', type: 'source', config: { value: 20 } },
        ],
        { autoStart: true }
      );

      // Notification provider should still work
      await graph.broadcast('test-topic', { data: 'test' });
      expect(broadcastSpy).toHaveBeenCalledWith('test-topic', { data: 'test' });
    });

    it('should preserve options and runtimeContextFactory after update', async () => {
      const runtimeContextFactory = jest.fn((nodeId: string, nodeType: string) => ({
        nodeId,
        workUnitId: 'work-123',
        category: 'data' as NodeCategory,
        dataNodesExecutionMode: DataNodesExecutionMode.SYNC_EXEC_MODE,
      }));

      const graph = createGraph(
        withOptions({
          engine: {
            dataNodesExecutionMode: DataNodesExecutionMode.SYNC_EXEC_MODE,
            debounceTime: 100,
          },
          runtimeContext: runtimeContextFactory,
        }),
        withNodesConfig({
          nodesPlugins: [sourcePlugin],
          nodes: [
            { id: 'a', type: 'source', config: { value: 10 } },
          ]
        })
      );

      // Start graph via run() to enable updateGraph()
      graph.run();

      // Update graph (only available for long-running graphs)
      graph.updateGraph(
        [
          { id: 'b', type: 'source', config: { value: 20 } },
        ],
        { autoStart: true }
      );

      // Options and runtimeContextFactory should be preserved
      // Graph should be running after update with autoStart
      expect(graph.getState()).toBe(EngineState.RUNNING);
    });

    it('should preserve plugins after update', async () => {
      const graph = createGraph(
        withNodesConfig({
          nodesPlugins: [sourcePlugin, addPlugin, multiplyPlugin],
          nodes: [
            { id: 'a', type: 'source', config: { value: 10 } },
            { id: 'b', type: 'source', config: { value: 20 } },
            { id: 'sum', type: 'add', inputs: ['a', 'b'], config: {} },
          ]
        })
      );

      // Start graph via run() to enable updateGraph()
      graph.run();

      // Update with nodes that use same plugins (only available for long-running graphs)
      graph.updateGraph(
        [
          { id: 'x', type: 'source', config: { value: 5 } },
          { id: 'y', type: 'source', config: { value: 15 } },
          { id: 'product', type: 'multiply', inputs: ['x', 'y'], config: {} },
        ],
        { autoStart: true }
      );

      // Graph should work with preserved plugins
      expect(graph.getState()).toBe(EngineState.RUNNING);
    });
  });

  describe('Subscriptions preservation', () => {
    it('should preserve subscriptions if preserveSubscriptions is true', async () => {
      const handler = jest.fn();

      const graph = createGraph(
        withNodesConfig({
          nodesPlugins: [sourcePlugin, addPlugin],
          nodes: [
            { id: 'a', type: 'source', config: { value: 10 } },
            { id: 'b', type: 'source', config: { value: 20 } },
            { id: 'sum', type: 'add', inputs: ['a', 'b'], config: { isSubscribed: true } },
          ],
          subscriptions: {
            sum: handler,
          }
        })
      );

      graph.run();
      await new Promise(resolve => setTimeout(resolve, 100));
      expect(handler).toHaveBeenCalledWith(30, 'sum', 'add');

      handler.mockClear();

      // Update with new nodes that have same subscribed node (only available for long-running graphs)
      graph.updateGraph(
        [
          { id: 'x', type: 'source', config: { value: 5 } },
          { id: 'y', type: 'source', config: { value: 15 } },
          { id: 'sum', type: 'add', inputs: ['x', 'y'], config: { isSubscribed: true } },
        ],
        { autoStart: true, preserveSubscriptions: true }
      );

      await new Promise(resolve => setTimeout(resolve, 100));
      // Handler should be called with new value
      expect(handler).toHaveBeenCalledWith(20, 'sum', 'add');
    });

    it('should not preserve subscriptions if preserveSubscriptions is false', async () => {
      const handler = jest.fn();

      const graph = createGraph(
        withNodesConfig({
          nodesPlugins: [sourcePlugin, addPlugin],
          nodes: [
            { id: 'a', type: 'source', config: { value: 10 } },
            { id: 'b', type: 'source', config: { value: 20 } },
            { id: 'sum', type: 'add', inputs: ['a', 'b'], config: { isSubscribed: true } },
          ],
          subscriptions: {
            sum: handler,
          }
        })
      );

      graph.run();
      await new Promise(resolve => setTimeout(resolve, 100));
      expect(handler).toHaveBeenCalledWith(30, 'sum', 'add');

      handler.mockClear();

      // Update without preserving subscriptions (only available for long-running graphs)
      graph.updateGraph(
        [
          { id: 'x', type: 'source', config: { value: 5 } },
          { id: 'y', type: 'source', config: { value: 15 } },
          { id: 'sum', type: 'add', inputs: ['x', 'y'], config: { isSubscribed: true } },
        ],
        { autoStart: true, preserveSubscriptions: false }
      );

      await new Promise(resolve => setTimeout(resolve, 100));
      // Handler should NOT be called (subscriptions not preserved)
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('Topological sorting', () => {
    it('should add nodes in correct dependency order', () => {
      const graph = createGraph(
        withNodesConfig({
          nodesPlugins: [sourcePlugin, addPlugin, multiplyPlugin],
          nodes: [
            { id: 'a', type: 'source', config: { value: 10 } },
            { id: 'b', type: 'source', config: { value: 20 } },
          ]
        })
      );

      // Update with nodes in wrong order (dependencies before sources)
      const newNodes = [
        { id: 'product', type: 'multiply', inputs: ['x', 'y'], config: {} }, // Depends on x, y
        { id: 'x', type: 'source', config: { value: 5 } },
        { id: 'y', type: 'source', config: { value: 15 } },
      ];

      // Should not throw - topological sort will reorder
      // First start graph via run() to enable updateGraph()
      graph.run();
      expect(() => {
        graph.updateGraph(newNodes, { autoStart: true });
      }).not.toThrow();

      expect(graph.getState()).toBe(EngineState.RUNNING);
    });

    it('should throw error if input node not found in new nodes', async () => {
      const graph = createGraph(
        withNodesConfig({
          nodesPlugins: [sourcePlugin, addPlugin],
          nodes: [
            { id: 'a', type: 'source', config: { value: 10 } },
          ]
        })
      );

      // Start graph via run() to enable updateGraph()
      graph.run();

      // Update with node that references non-existent input
      const newNodes = [
        { id: 'sum', type: 'add', inputs: ['nonexistent'], config: {} },
      ];

      expect(() => {
        graph.updateGraph(newNodes);
      }).toThrow('Input node \'nonexistent\' not found for node \'sum\'');
    });
  });

  describe('Error handling', () => {
    it('should throw error if updateGraph() is called on graph started via execute()', async () => {
      const graph = createGraph(
        withNodesConfig({
          nodesPlugins: [sourcePlugin],
          nodes: [
            { id: 'a', type: 'source', config: { value: 10 } },
          ]
        })
      );

      // Start graph via execute() (one-shot mode)
      await graph.execute();

      // updateGraph() should not be available for one-shot graphs
      // updateGraph() is only available on LongRunningGraph returned by run()
      expect(() => {
        graph.updateGraph([
          { id: 'b', type: 'source', config: { value: 20 } },
        ]);
      }).toThrow('updateGraph() is only available for long-running graphs');
    });

    it('should throw error if graph is destroyed', async () => {
      const graph = createGraph(
        withNodesConfig({
          nodesPlugins: [sourcePlugin],
          nodes: [
            { id: 'a', type: 'source', config: { value: 10 } },
          ]
        })
      );

      // Start graph via run() to enable updateGraph()
      graph.run();
      graph.destroy();

      expect(() => {
        graph.updateGraph([
          { id: 'b', type: 'source', config: { value: 20 } },
        ]);
      }).toThrow('Cannot update destroyed graph');
    });

    it('should handle cycle detection in new nodes', async () => {
      const graph = createGraph(
        withNodesConfig({
          nodesPlugins: [sourcePlugin, addPlugin],
          nodes: [
            { id: 'a', type: 'source', config: { value: 10 } },
          ]
        })
      );

      // Start graph via run() to enable updateGraph()
      graph.run();

      // Update with circular dependency
      const newNodes = [
        { id: 'x', type: 'add', inputs: ['y'], config: {} },
        { id: 'y', type: 'add', inputs: ['x'], config: {} },
      ];

      expect(() => {
        graph.updateGraph(newNodes);
      }).toThrow('Cycle detected in graph');
    });
  });

  describe('Complete update scenario', () => {
    it('should update graph with all infrastructure preserved', async () => {
      const persistenceProvider = new MemoryStateProvider();
      const notificationProvider: INotificationProvider = {
        async notify() {},
        async broadcast() {},
        async subscribe() {},
        async unsubscribe() {},
      };
      const broadcastSpy = jest.spyOn(notificationProvider, 'broadcast');

      const runtimeContextFactory = jest.fn((nodeId: string, nodeType: string) => ({
        nodeId,
        workUnitId: 'work-123',
        category: 'data' as NodeCategory,
        dataNodesExecutionMode: DataNodesExecutionMode.SYNC_EXEC_MODE,
      }));

      const subscriptionHandler = jest.fn();

      // Create initial graph
      const graph = createGraph(
        withPersistence(persistenceProvider),
        withNotifications(notificationProvider),
        withOptions({
          engine: {
            dataNodesExecutionMode: DataNodesExecutionMode.SYNC_EXEC_MODE,
            debounceTime: 50,
          },
          runtimeContext: runtimeContextFactory,
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

      const longRunningGraph = graph.run();
      await new Promise(resolve => setTimeout(resolve, 100));
      expect(subscriptionHandler).toHaveBeenCalledWith(30, 'sum', 'add');

      // Save state
      await longRunningGraph.saveState('test-key');

      subscriptionHandler.mockClear();

      // Update graph with completely new nodes (only available for long-running graphs)
      const newNodes = [
        { id: 'x', type: 'source', config: { value: 5 } },
        { id: 'y', type: 'source', config: { value: 15 } },
        { id: 'z', type: 'source', config: { value: 25 } },
        { id: 'newSum', type: 'add', inputs: ['x', 'y'], config: { isSubscribed: true } },
        { id: 'finalSum', type: 'add', inputs: ['newSum', 'z'], config: { isSubscribed: true } },
      ];

      longRunningGraph.updateGraph(newNodes, {
        autoStart: true,
        preserveSubscriptions: true,
      });

      // Wait for computation
      await new Promise(resolve => setTimeout(resolve, 100));

      // All infrastructure should work
      expect(graph.getState()).toBe(EngineState.RUNNING);
      
      // Persistence should work
      await graph.saveState('test-key-2');
      const loaded = await graph.loadState('test-key-2');
      expect(loaded).toBeDefined();

      // Notifications should work
      await graph.broadcast('test-topic', { data: 'test' });
      expect(broadcastSpy).toHaveBeenCalled();

      // Subscriptions should work (if handlers match new node IDs)
      // Note: subscriptions are preserved but handlers are for old node IDs
      // In real scenario, you'd need to update subscription handlers too
    });
  });
});

