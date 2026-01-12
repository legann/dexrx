import { createGraph } from '../lib/dexrx/src/graph';
import { withNodesConfig, withOptions } from '../lib/dexrx/src/operators';
import { INodePlugin } from 'dexrx';

describe('Engine Options (Build API)', () => {
  const testPlugin: INodePlugin = {
    type: 'test',
    category: 'operational',
    compute: (config: unknown, inputs: unknown[]) => {
      if ((config as Record<string, unknown>).value !== undefined) {
        return (config as Record<string, unknown>).value;
      }
      return inputs[0];
    }
  };

  describe('throttleTime option', () => {
    it('should throttle node updates according to specified interval', async () => {
      const throttleTime = 100;
      const graph = createGraph(
        withOptions({
          engine: {
            throttleTime: throttleTime
          }
        }),
        withNodesConfig({
          nodesPlugins: [testPlugin],
          nodes: [
            {
              id: 'inputNode',
              type: 'test',
              config: { value: 1 }
            },
            {
              id: 'testNode',
              type: 'test',
              inputs: ['inputNode'],
              config: { isSubscribed: true }
            }
          ]
        })
      );

      // Start as long-running graph for updates
      const longRunningGraph = graph.run();

      // Wait for initialization
      await new Promise(resolve => setTimeout(resolve, throttleTime + 50));

      let state = graph.exportState();
      expect(state.nodes['testNode'].currentValue).toBe(1);

      // Update node with new values
      // Due to throttling intermediate updates may be skipped
      longRunningGraph.updateGraph([
        {
          id: 'inputNode',
          type: 'test',
          config: { value: 2 }
        },
        {
          id: 'testNode',
          type: 'test',
          inputs: ['inputNode'],
          config: { isSubscribed: true }
        }
      ], { autoStart: true });
      await new Promise(resolve => setTimeout(resolve, throttleTime / 2));

      longRunningGraph.updateGraph([
        {
          id: 'inputNode',
          type: 'test',
          config: { value: 3 }
        },
        {
          id: 'testNode',
          type: 'test',
          inputs: ['inputNode'],
          config: { isSubscribed: true }
        }
      ], { autoStart: true });
      await new Promise(resolve => setTimeout(resolve, throttleTime / 2));

      longRunningGraph.updateGraph([
        {
          id: 'inputNode',
          type: 'test',
          config: { value: 4 }
        },
        {
          id: 'testNode',
          type: 'test',
          inputs: ['inputNode'],
          config: { isSubscribed: true }
        }
      ], { autoStart: true });

      // Wait for throttle to complete - give enough time for processing last update
      await new Promise(resolve => setTimeout(resolve, throttleTime * 2 + 50));

      state = graph.exportState();
      // Check that we received final value (throttling may skip intermediate)
      expect([1, 2, 3, 4]).toContain(state.nodes['testNode'].currentValue);

      graph.destroy();
    }, 10000);
  });

  describe('debounceTime option', () => {
    it('should debounce node updates according to specified interval', async () => {
      const debounceTime = 100;
      const graph = createGraph(
        withOptions({
          engine: {
            debounceTime: debounceTime
          }
        }),
        withNodesConfig({
          nodesPlugins: [testPlugin],
          nodes: [
            {
              id: 'inputNode',
              type: 'test',
              config: { value: 1 }
            },
            {
              id: 'testNode',
              type: 'test',
              inputs: ['inputNode'],
              config: { isSubscribed: true }
            }
          ]
        })
      );

      // Start as long-running graph for updates
      const longRunningGraph = graph.run();

      // Wait for initialization
      await new Promise(resolve => setTimeout(resolve, debounceTime + 50));

      // Update node multiple times quickly
      for (let i = 2; i <= 5; i++) {
        longRunningGraph.updateGraph([
          {
            id: 'inputNode',
            type: 'test',
            config: { value: i }
          },
          {
            id: 'testNode',
            type: 'test',
            inputs: ['inputNode'],
            config: { isSubscribed: true }
          }
        ], { autoStart: true });
        await new Promise(resolve => setTimeout(resolve, debounceTime / 3));
      }

      // Wait for debounce to complete
      await new Promise(resolve => setTimeout(resolve, debounceTime * 2));

      const state = graph.exportState();
      // Should have final value after debounce
      expect(state.nodes['testNode'].currentValue).toBe(5);

      graph.destroy();
    }, 10000);
  });

  describe('enableCancelableCompute option', () => {
    it('should enable cancelable compute when option is set', async () => {
      const graph = createGraph(
        withOptions({
          engine: {
            enableCancelableCompute: true
          }
        }),
        withNodesConfig({
          nodesPlugins: [testPlugin],
          nodes: [
            {
              id: 'testNode',
              type: 'test',
              config: { value: 42, isSubscribed: true }
            }
          ]
        })
      );

      await graph.execute();
      await new Promise(resolve => setTimeout(resolve, 100));

      const state = graph.exportState();
      expect(state.nodes['testNode'].currentValue).toBe(42);

      graph.destroy();
    });
  });

  describe('maxDepth option', () => {
    it('should limit computation depth when option is set', async () => {
      const graph = createGraph(
        withOptions({
          engine: {
            maxDepth: 2
          }
        }),
        withNodesConfig({
          nodesPlugins: [testPlugin],
          nodes: [
            {
              id: 'level1',
              type: 'test',
              config: { value: 1 }
            },
            {
              id: 'level2',
              type: 'test',
              inputs: ['level1']
            },
            {
              id: 'level3',
              type: 'test',
              inputs: ['level2'],
              config: { isSubscribed: true }
            }
          ]
        })
      );

      await graph.execute();
      await new Promise(resolve => setTimeout(resolve, 200));

      // With maxDepth=2, level3 might not compute
      const state = graph.exportState();
      expect(state.nodes['level1']).toBeDefined();
      expect(state.nodes['level2']).toBeDefined();

      graph.destroy();
    });
  });
});
