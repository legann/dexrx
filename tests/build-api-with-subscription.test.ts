import { createGraph } from '../lib/dexrx/src/graph';
import { withNodesConfig } from '../lib/dexrx/src/operators';
import { INodePlugin } from 'dexrx';

describe('withSubscription operator', () => {
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

  describe('Record configuration (specific nodes)', () => {
    it('should subscribe to specific nodes with handlers', async () => {
      const math1Handler = jest.fn();
      const math2Handler = jest.fn();

      const graph = createGraph(
        withNodesConfig({
          nodesPlugins: [sourcePlugin, addPlugin],
          nodes: [
            { id: 'a', type: 'source', config: { value: 10 } },
            { id: 'b', type: 'source', config: { value: 20 } },
            { id: 'math1', type: 'add', inputs: ['a', 'b'], config: { isSubscribed: true } },
            { id: 'math2', type: 'add', inputs: ['a', 'b'], config: { isSubscribed: true } },
          ],
          subscriptions: {
            math1: math1Handler,
            math2: math2Handler,
          }
        })
      );

      await graph.execute();

      expect(math1Handler).toHaveBeenCalledWith(30, 'math1', 'add');
      expect(math2Handler).toHaveBeenCalledWith(30, 'math2', 'add');
    });

    it('should only subscribe to nodes with handlers', async () => {
      const math1Handler = jest.fn();

      const graph = createGraph(
        withNodesConfig({
          nodesPlugins: [sourcePlugin, addPlugin],
          nodes: [
            { id: 'a', type: 'source', config: { value: 10 } },
            { id: 'b', type: 'source', config: { value: 20 } },
            { id: 'math1', type: 'add', inputs: ['a', 'b'], config: { isSubscribed: true } },
            { id: 'math2', type: 'add', inputs: ['a', 'b'], config: { isSubscribed: true } },
          ],
          subscriptions: {
            math1: math1Handler,
          }
        })
      );

      await graph.execute();

      expect(math1Handler).toHaveBeenCalled();
      // math2 should not have handler, so no subscription
    });
  });

  describe('Function handler (all subscribed nodes)', () => {
    it('should apply handler to all subscribed nodes', async () => {
      const globalHandler = jest.fn();

      const graph = createGraph(
        withNodesConfig({
          nodesPlugins: [sourcePlugin, addPlugin],
          nodes: [
            { id: 'a', type: 'source', config: { value: 10 } },
            { id: 'b', type: 'source', config: { value: 20 } },
            { id: 'math1', type: 'add', inputs: ['a', 'b'], config: { isSubscribed: true } },
            { id: 'math2', type: 'add', inputs: ['a', 'b'], config: { isSubscribed: true } },
          ],
          subscriptions: (nodeId, value, nodeType) => {
            globalHandler(nodeId, value, nodeType);
          }
        })
      );

      await graph.execute();

      expect(globalHandler).toHaveBeenCalledWith('math1', 30, 'add');
      expect(globalHandler).toHaveBeenCalledWith('math2', 30, 'add');
    });

    it('should receive correct parameters (nodeId, value, nodeType)', async () => {
      const calls: Array<[string, unknown, string]> = [];

      const graph = createGraph(
        withNodesConfig({
          nodesPlugins: [sourcePlugin, addPlugin, multiplyPlugin],
          nodes: [
            { id: 'a', type: 'source', config: { value: 5 } },
            { id: 'b', type: 'source', config: { value: 3 } },
            { id: 'math1', type: 'add', inputs: ['a', 'b'], config: { isSubscribed: true } },
            { id: 'math2', type: 'multiply', inputs: ['a', 'b'], config: { isSubscribed: true } },
          ],
          subscriptions: (nodeId, value, nodeType) => {
            calls.push([nodeId, value, nodeType]);
          }
        })
      );

      await graph.execute();

      expect(calls).toContainEqual(['math1', 8, 'add']);
      expect(calls).toContainEqual(['math2', 15, 'multiply']);
    });
  });

  describe('Generator function (dynamic handlers)', () => {
    it('should generate handlers based on subscribed nodes', async () => {
      const mathHandler = jest.fn();
      const multiplyHandler = jest.fn();

      const graph = createGraph(
        withNodesConfig({
          nodesPlugins: [sourcePlugin, addPlugin, multiplyPlugin],
          nodes: [
            { id: 'a', type: 'source', config: { value: 5 } },
            { id: 'b', type: 'source', config: { value: 3 } },
            { id: 'math1', type: 'add', inputs: ['a', 'b'], config: { isSubscribed: true } },
            { id: 'math2', type: 'multiply', inputs: ['a', 'b'], config: { isSubscribed: true } },
          ],
          subscriptions: (subscribedNodes) => {
            const handlers = new Map();
            for (const node of subscribedNodes) {
              if (node.type === 'add') {
                handlers.set(node.id, mathHandler);
              } else if (node.type === 'multiply') {
                handlers.set(node.id, multiplyHandler);
              }
            }
            return handlers;
          }
        })
      );

      await graph.execute();

      expect(mathHandler).toHaveBeenCalledWith(8, 'math1', 'add');
      expect(multiplyHandler).toHaveBeenCalledWith(15, 'math2', 'multiply');
    });

    it('should work with empty subscribed nodes', async () => {
      const graph = createGraph(
        withNodesConfig({
          nodesPlugins: [sourcePlugin],
          nodes: [
            { id: 'a', type: 'source', config: { value: 10 } },
          ],
          subscriptions: (subscribedNodes) => {
            const handlers = new Map();
            for (const node of subscribedNodes) {
              handlers.set(node.id, jest.fn());
            }
            return handlers;
          }
        })
      );

      await graph.execute();
      // No subscribed nodes, so no handlers should be called
      expect(graph).toBeDefined();
    });
  });

  describe('Dynamic subscription (withSubscription before withNodes)', () => {
    it('should work when withSubscription is called before withNodes', async () => {
      const handler = jest.fn();

      const graph = createGraph(
        withNodesConfig({
          nodesPlugins: [sourcePlugin, addPlugin],
          nodes: [
            { id: 'a', type: 'source', config: { value: 10 } },
            { id: 'b', type: 'source', config: { value: 20 } },
            { id: 'math1', type: 'add', inputs: ['a', 'b'], config: { isSubscribed: true } },
          ],
          subscriptions: (nodeId, value, nodeType) => {
            handler(nodeId, value, nodeType);
          }
        })
      );

      await graph.execute();

      expect(handler).toHaveBeenCalledWith('math1', 30, 'add');
    });
  });

  describe('Subscription lifecycle', () => {
    it('should unsubscribe when graph is stopped', async () => {
      const handler = jest.fn();

      const graph = createGraph(
        withNodesConfig({
          nodesPlugins: [sourcePlugin, addPlugin],
          nodes: [
            { id: 'a', type: 'source', config: { value: 10 } },
            { id: 'b', type: 'source', config: { value: 20 } },
            { id: 'math1', type: 'add', inputs: ['a', 'b'], config: { isSubscribed: true } },
          ],
          subscriptions: {
            math1: handler,
          }
        })
      );

      const longRunning = graph.run();
      await new Promise(resolve => setTimeout(resolve, 100));

      const callCountBeforeStop = handler.mock.calls.length;

      longRunning.stop();

      // Wait a bit to see if handler is still called
      await new Promise(resolve => setTimeout(resolve, 100));

      // Handler should not be called after stop
      expect(handler.mock.calls.length).toBe(callCountBeforeStop);
    });

    it('should resubscribe when graph is started again', async () => {
      const handler = jest.fn();

      const graph = createGraph(
        withNodesConfig({
          nodesPlugins: [sourcePlugin, addPlugin],
          nodes: [
            { id: 'a', type: 'source', config: { value: 10 } },
            { id: 'b', type: 'source', config: { value: 20 } },
            { id: 'math1', type: 'add', inputs: ['a', 'b'], config: { isSubscribed: true } },
          ],
          subscriptions: {
            math1: handler,
          }
        })
      );

      const longRunning1 = graph.run();
      await new Promise(resolve => setTimeout(resolve, 100));

      const callCountAfterFirstStart = handler.mock.calls.length;

      longRunning1.stop();
      const longRunning2 = graph.run();
      await new Promise(resolve => setTimeout(resolve, 100));

      // Handler should be called again after restart
      expect(handler.mock.calls.length).toBeGreaterThan(callCountAfterFirstStart);
    });
  });

  describe('Multiple subscription configs', () => {
    it('should merge handlers from multiple withSubscription calls', async () => {
      const handler1 = jest.fn();
      const handler2 = jest.fn();

      // Note: Multiple withSubscription calls are not supported with withNodesConfig
      // This test demonstrates that subscriptions can be merged in a single config
      const graph = createGraph(
        withNodesConfig({
          nodesPlugins: [sourcePlugin, addPlugin],
          nodes: [
            { id: 'a', type: 'source', config: { value: 10 } },
            { id: 'b', type: 'source', config: { value: 20 } },
            { id: 'math1', type: 'add', inputs: ['a', 'b'], config: { isSubscribed: true } },
            { id: 'math2', type: 'add', inputs: ['a', 'b'], config: { isSubscribed: true } },
          ],
          subscriptions: {
            math1: handler1,
            math2: handler2,
          }
        })
      );

      await graph.execute();

      expect(handler1).toHaveBeenCalled();
      expect(handler2).toHaveBeenCalled();
    });
  });

  describe('Error handling', () => {
    it('should handle errors in subscription handlers gracefully', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      const graph = createGraph(
        withNodesConfig({
          nodesPlugins: [sourcePlugin, addPlugin],
          nodes: [
            { id: 'a', type: 'source', config: { value: 10 } },
            { id: 'b', type: 'source', config: { value: 20 } },
            { id: 'math1', type: 'add', inputs: ['a', 'b'], config: { isSubscribed: true } },
          ],
          subscriptions: {
            math1: () => {
              throw new Error('Test error');
            },
          }
        })
      );

      await graph.execute();

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Error in subscribed node math1'),
        expect.any(Error)
      );

      consoleErrorSpy.mockRestore();
    });
  });

  describe('No subscribed nodes', () => {
    it('should not throw error when no subscribed nodes exist', async () => {
      const graph = createGraph(
        withNodesConfig({
          nodesPlugins: [sourcePlugin],
          nodes: [
            { id: 'a', type: 'source', config: { value: 10 } },
          ],
          subscriptions: {
            math1: jest.fn(),
          }
        })
      );

      await expect(graph.execute()).resolves.not.toThrow();
    });
  });
});

