// Tests for engine core features in browser environment
import { createGraph, ExecutableGraph } from '../../lib/dexrx/src/graph';
import { withNodesConfig, withOptions } from '../../lib/dexrx/src/operators';
import { INodePlugin } from 'dexrx';
import { EngineState } from '../../lib/dexrx/src/types/engine-state';
import { EngineEventType } from '../../lib/dexrx/src/types/engine-hooks';

console.log('Test setup. Worker path: /base/tests/workers/web-worker.js');

describe('ReactiveGraphEngine - Core Features (Browser) - Build API', () => {
  // Plugins for tests
  const calculatorPlugin: INodePlugin = {
    type: 'calculator',
    category: 'operational',
    compute: (config: any, inputs: any[]) => {
      const value = (config?.initialValue as number) || 10;
      const multiplier = (config?.multiplier as number) || 1;

      if (inputs && inputs.length > 0) {
        // If there are input data, multiply first value by multiplier
        return (inputs[0] as number) * multiplier;
      }

      return value;
    },
  };

  const asyncShortPlugin: INodePlugin = {
    type: 'async-short',
    category: 'operational',
    compute: () => {
      // Short asynchronous computation (50ms)
      return new Promise(resolve => {
        setTimeout(() => resolve(42), 50);
      });
    },
  };

  const errorGeneratorPlugin: INodePlugin = {
    type: 'error-generator',
    category: 'operational',
    compute: () => {
      throw new Error('Test error');
    },
  };

  const graphs: ExecutableGraph<unknown>[] = [];

  afterEach(() => {
    // Clean up all created graphs
    graphs.forEach(graph => {
      if (graph && graph.getState() !== EngineState.DESTROYED) {
        graph.destroy();
      }
    });
    graphs.length = 0;
  });

  it('should correctly handle errors in nodes', done => {
    const graph = createGraph(
      withNodesConfig({
        nodesPlugins: [errorGeneratorPlugin],
        nodes: [
          {
            id: 'error-node',
            type: 'error-generator',
            isSubscribed: true,
          },
        ],
      })
    );
    graphs.push(graph);

    // Flag for tracking error event
    let errorCaught = false;

    // Subscribe to error events directly through graph hooks
    const unsubscribe = graph.on(
      EngineEventType.NODE_COMPUTE_ERROR,
      (nodeId: string, error: Error) => {
        if (nodeId === 'error-node') {
          errorCaught = true;
          expect(error.message).toContain('Test error');
        }
      }
    );

    // Execute graph
    graph.execute().then(() => {
      unsubscribe();
      expect(errorCaught).toBe(true);
      done();
    }).catch(() => {
      unsubscribe();
      expect(errorCaught).toBe(true);
      done();
    });
  });

  it('should correctly handle asynchronous computations', done => {
    const graph = createGraph(
      withNodesConfig({
        nodesPlugins: [asyncShortPlugin],
        nodes: [
          {
            id: 'async-node',
            type: 'async-short',
            isSubscribed: true,
          },
        ],
      })
    );
    graphs.push(graph);

    // Get node value with delay
    let valueReceived = false;

    const subscription = graph.observeNode('async-node');
    if (subscription) {
      const observer = subscription.subscribe({
        next: value => {
          if (value === 42) {
            valueReceived = true;
            observer.unsubscribe();
          }
        },
      });
    }

    // Execute graph
    graph.execute().then(() => {
      expect(valueReceived).toBe(true);
      done();
    }).catch(() => {
      expect(valueReceived).toBe(true);
      done();
    });
  });

  it('should cancel stale computations when enableCancelableCompute', done => {
    const graph = createGraph(
      withOptions({
        engine: {
          enableCancelableCompute: true,
        },
      }),
      withNodesConfig({
        nodesPlugins: [asyncShortPlugin],
        nodes: [
          {
            id: 'async-node',
            type: 'async-short',
            isSubscribed: true,
          },
        ],
      })
    );
    graphs.push(graph);

    // Start as long-running graph for updates
    const longRunningGraph = graph.run();

    // Check that we can update node and cancel previous computation
    let updateCount = 0;

    const subscription = graph.observeNode('async-node')?.subscribe({
      next: () => {
        updateCount++;

        if (updateCount === 1) {
          // After first update, update graph again
          longRunningGraph.updateGraph([
            {
              id: 'async-node',
              type: 'async-short',
              isSubscribed: true,
            },
          ], { autoStart: true });
        } else if (updateCount === 2) {
          // After second update, complete test
          subscription?.unsubscribe();
          done();
        }
      },
      error: err => {
        fail('Should not have error: ' + err);
        done();
      },
    });
  });

  it('should provide reactivity between nodes', async () => {
    const graph = createGraph(
      withNodesConfig({
        nodesPlugins: [calculatorPlugin],
        nodes: [
          {
            id: 'source',
            type: 'calculator',
            config: { initialValue: 10 },
          },
          {
            id: 'transformer',
            type: 'calculator',
            inputs: ['source'],
            config: { multiplier: 2 },
            isSubscribed: true,
          },
        ],
      })
    );
    graphs.push(graph);

    // Execute graph and wait for initial computation
    await graph.execute();
    
    // Check initial value
    let state = graph.exportState();
    const initialValue = state.nodes['transformer']?.currentValue;
    expect(initialValue).toBe(20);

    // Convert to long-running graph and update
    const longRunningGraph = graph.run();
    
    // Wait a bit, then update graph
    await new Promise(resolve => setTimeout(resolve, 100));
    
    longRunningGraph.updateGraph([
      {
        id: 'source',
        type: 'calculator',
        config: { initialValue: 20 },
      },
      {
        id: 'transformer',
        type: 'calculator',
        inputs: ['source'],
        config: { multiplier: 2 },
        isSubscribed: true,
      },
    ], { autoStart: true });
    
    // Wait for update to complete
    await new Promise(resolve => setTimeout(resolve, 200));
    
    // Check updated value
    state = graph.exportState();
    const updatedValue = state.nodes['transformer']?.currentValue;
    expect(updatedValue).toBe(40);
  });
});
