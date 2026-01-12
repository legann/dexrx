import { createGraph, LongRunningGraph } from '../lib/dexrx/src/graph';
import { withNodesConfig, withOptions } from '../lib/dexrx/src/operators';
import { INodePlugin } from 'dexrx';
import { INIT_NODE_EXEC } from '../lib/dexrx/src/types/engine-flags';
import { Subscription } from 'rxjs';
import { filterInitExec } from './utils/test-helpers';

/**
 * Unified core tests for Build API
 * Combines tests from engine.test.ts, advanced.test.ts, engine.e2e.test.ts
 * Removes duplicates and organizes by functionality
 */

// Shared plugins for all tests
const staticNode: INodePlugin = {
  type: "Static",
  category: 'data',
  compute(config, _inputs) {
    return config.value;
  }
};

const aggNode: INodePlugin = {
  type: "Agg",
  category: 'operational',
  compute(config: { mode?: string }, inputs: unknown[]): unknown {
    const mode = config?.mode ?? "pointwise";

    if (inputs.length === 0) {
      switch (mode) {
        case "pointwise":
        case "concat":
          return [];
        case "sum":
          return 0;
        default:
          return null;
      }
    }

    switch (mode) {
      case "pointwise": {
        const arrays = (inputs ?? []).filter(a => Array.isArray(a)) as number[][];
        if (arrays.length === 0) return [];
        const length = arrays[0]?.length ?? 0;
        return Array.from({ length }, (_, i) =>
          arrays.reduce((sum, arr) => sum + (arr[i] ?? 0), 0)
        );
      }

      case "concat": {
        return (inputs as unknown[][]).flat();
      }

      case "sum": {
        return (inputs as number[][]).reduce(
          (acc, arr) => acc + arr.reduce((a, b) => a + b, 0),
          0
        );
      }

      default:
        return null;
    }
  }
};

describe("ExecutableGraph - Core Tests (Build API)", () => {
  // ============================================
  // Basic Computation Tests
  // ============================================

  describe("Basic computation", () => {
    it("computes static node value", async () => {
      const graph = createGraph(
        withNodesConfig({
          nodesPlugins: [staticNode],
          nodes: [
            { id: "a", type: "Static", config: { value: 42, isSubscribed: true } }
          ]
        })
      );

      await graph.execute();

      const state = graph.exportState();
      expect(state.nodes["a"].currentValue).toBe(42);
      graph.destroy();
    });

    it("computes agg from static nodes", async () => {
      const graph = createGraph(
        withNodesConfig({
          nodesPlugins: [staticNode, aggNode],
          nodes: [
            { id: "a", type: "Static", config: { value: [1, 2] } },
            { id: "b", type: "Static", config: { value: [3, 4] } },
            {
              id: "agg",
              type: "Agg",
              config: { mode: "pointwise", isSubscribed: true },
              inputs: ["a", "b"]
            }
          ]
        })
      );

      await graph.execute();

      const state = graph.exportState();
      expect(state.nodes["agg"].currentValue).toEqual([4, 6]);
      graph.destroy();
    });

    it("works with different aggregation modes", async () => {
      const graph = createGraph(
        withNodesConfig({
          nodesPlugins: [staticNode, aggNode],
          nodes: [
            { id: "a", type: "Static", config: { value: [1, 2, 3] } },
            { id: "b", type: "Static", config: { value: [4, 5, 6] } },
            {
              id: "pointwise",
              type: "Agg",
              config: { mode: "pointwise", isSubscribed: true },
              inputs: ["a", "b"]
            },
            {
              id: "concat",
              type: "Agg",
              config: { mode: "concat", isSubscribed: true },
              inputs: ["a", "b"]
            },
            {
              id: "sum",
              type: "Agg",
              config: { mode: "sum", isSubscribed: true },
              inputs: ["a", "b"]
            }
          ]
        })
      );

      await graph.execute();

      const state = graph.exportState();
      expect(state.nodes["pointwise"].currentValue).toEqual([5, 7, 9]);
      expect(state.nodes["concat"].currentValue).toEqual([1, 2, 3, 4, 5, 6]);
      expect(state.nodes["sum"].currentValue).toBe(21);

      graph.destroy();
    });

    it("handles empty inputs correctly", async () => {
      const graph = createGraph(
        withNodesConfig({
          nodesPlugins: [aggNode],
          nodes: [
            {
              id: "empty",
              type: "Agg",
              config: { mode: "pointwise", isSubscribed: true },
              inputs: []
            },
            {
              id: "emptySum",
              type: "Agg",
              config: { mode: "sum", isSubscribed: true },
              inputs: []
            },
            {
              id: "emptyConcat",
              type: "Agg",
              config: { mode: "concat", isSubscribed: true },
              inputs: []
            }
          ]
        })
      );

      await graph.execute();

      const state = graph.exportState();
      expect(state.nodes["empty"].currentValue).toEqual([]);
      expect(state.nodes["emptySum"].currentValue).toBe(0);
      expect(state.nodes["emptyConcat"].currentValue).toEqual([]);

      graph.destroy();
    });

    it("handles single input correctly", async () => {
      const graph = createGraph(
        withNodesConfig({
          nodesPlugins: [staticNode, aggNode],
          nodes: [
            { id: "a", type: "Static", config: { value: [1, 2, 3] } },
            {
              id: "single",
              type: "Agg",
              config: { mode: "pointwise", isSubscribed: true },
              inputs: ["a"]
            }
          ]
        })
      );

      await graph.execute();

      const state = graph.exportState();
      expect(state.nodes["single"].currentValue).toEqual([1, 2, 3]);

      graph.destroy();
    });
  });

  // ============================================
  // Graph Updates and Reactivity
  // ============================================

  describe("Graph updates and reactivity", () => {
    it("updates node and triggers recompute", async () => {
      const graph = createGraph(
        withNodesConfig({
          nodesPlugins: [staticNode, aggNode],
          nodes: [
            { id: "a", type: "Static", config: { value: [1, 2] } },
            { id: "b", type: "Static", config: { value: [3, 4] } },
            {
              id: "agg",
              type: "Agg",
              config: { mode: "pointwise", isSubscribed: true },
              inputs: ["a", "b"]
            }
          ]
        })
      );

      const longRunningGraph = graph.run();
      await new Promise(resolve => setTimeout(resolve, 100));

      let state = graph.exportState();
      expect(state.nodes["agg"].currentValue).toEqual([4, 6]);

      longRunningGraph.updateGraph([
        { id: "a", type: "Static", config: { value: [3, 4] } },
        { id: "b", type: "Static", config: { value: [3, 4] } },
        {
          id: "agg",
          type: "Agg",
          config: { mode: "pointwise", isSubscribed: true },
          inputs: ["a", "b"]
        }
      ], { autoStart: true });

      await new Promise(resolve => setTimeout(resolve, 100));

      state = graph.exportState();
      expect(state.nodes["agg"].currentValue).toEqual([6, 8]);
      
      graph.destroy();
    });

    it("handles multiple updates", async () => {
      const graph = createGraph(
        withNodesConfig({
          nodesPlugins: [staticNode],
          nodes: [
            { id: "source", type: "Static", config: { value: [1], isSubscribed: true } }
          ]
        })
      );

      const longRunningGraph = graph.run();
      await new Promise(resolve => setTimeout(resolve, 50));

      longRunningGraph.updateGraph([
        { id: "source", type: "Static", config: { value: [5], isSubscribed: true } }
      ], { autoStart: true });

      await new Promise(resolve => setTimeout(resolve, 100));

      const state = graph.exportState();
      expect(state.nodes["source"].currentValue).toEqual([5]);

      graph.destroy();
    });

    it("end-to-end: add, update, remove nodes and check results", async () => {
      const graph = createGraph(
        withNodesConfig({
          nodesPlugins: [staticNode, aggNode],
          nodes: [
            { id: 'a', type: 'Static', config: { value: [1, 2, 3] } },
            { id: 'b', type: 'Static', config: { value: [10, 20, 30] } },
            {
              id: 'agg',
              type: 'Agg',
              config: { mode: 'pointwise', isSubscribed: true },
              inputs: ['a', 'b']
            }
          ]
        })
      );

      const results: any[] = [];
      let sub: Subscription | undefined;

      await graph.execute();

      const longRunningGraph: LongRunningGraph = graph.run();

      sub = graph.observeNode('agg')?.pipe(
        filterInitExec()
      ).subscribe(val => {
        results.push(val);

        if (results.length === 1) {
          expect(val).toEqual([11, 22, 33]);

          setTimeout(() => {
            longRunningGraph.updateGraph([
              {
                id: 'a',
                type: 'Static',
                config: { value: [2, 3, 4] }
              },
              {
                id: 'b',
                type: 'Static',
                config: { value: [10, 20, 30] }
              },
              {
                id: 'agg',
                type: 'Agg',
                config: { mode: 'pointwise', isSubscribed: true },
                inputs: ['a', 'b']
              }
            ], { autoStart: true });
          }, 0);
        } else if (results.length === 2) {
          expect(val).toEqual([12, 23, 34]);

          longRunningGraph.updateGraph([
            {
              id: 'a',
              type: 'Static',
              config: { value: [2, 3, 4] }
            },
            {
              id: 'agg',
              type: 'Agg',
              config: { mode: 'pointwise', isSubscribed: true },
              inputs: ['a']
            }
          ], { autoStart: true });

        } else if (results.length === 3) {
          expect(val).toEqual([2, 3, 4]);
          sub?.unsubscribe();
        }
      });

      await new Promise(resolve => setTimeout(resolve, 1000));

      sub?.unsubscribe();
      graph.destroy();
    });
  });

  // ============================================
  // Graph Structure Tests
  // ============================================

  describe("Graph structure", () => {
    it("correctly handles 'diamond' graph structure", async () => {
      const graph = createGraph(
        withNodesConfig({
          nodesPlugins: [staticNode, aggNode],
          nodes: [
            { id: "A", type: "Static", config: { value: [1, 2] } },
            { id: "B", type: "Static", config: { value: [3, 4] } },
            { id: "C", type: "Static", config: { value: [5, 6] } },
            {
              id: "D",
              type: "Agg",
              config: { mode: "pointwise", isSubscribed: true },
              inputs: ["B", "C"]
            }
          ]
        })
      );

      await graph.execute();

      let state = graph.exportState();
      expect(state.nodes["D"].currentValue).toEqual([8, 10]);

      const longRunningGraph = graph.run();
      longRunningGraph.updateGraph([
        { id: "A", type: "Static", config: { value: [1, 2] } },
        { id: "B", type: "Static", config: { value: [3, 4] } },
        { id: "C", type: "Static", config: { value: [10, 20] } },
        {
          id: "D",
          type: "Agg",
          config: { mode: "pointwise", isSubscribed: true },
          inputs: ["B", "C"]
        }
      ], { autoStart: true });

      await new Promise(resolve => setTimeout(resolve, 100));

      state = graph.exportState();
      expect(state.nodes["D"].currentValue).toEqual([13, 24]);

      graph.destroy();
    });

    it("handles complex nested dependencies", async () => {
      const graph = createGraph(
        withNodesConfig({
          nodesPlugins: [staticNode, aggNode],
          nodes: [
            { id: "A", type: "Static", config: { value: [1] } },
            { id: "B", type: "Agg", config: { mode: "pointwise" }, inputs: ["A"] },
            { id: "C", type: "Agg", config: { mode: "pointwise" }, inputs: ["A"] },
            {
              id: "D",
              type: "Agg",
              config: { mode: "pointwise", isSubscribed: true },
              inputs: ["B", "C"]
            },
            { id: "E", type: "Static", config: { value: [2] } },
            { id: "F", type: "Agg", config: { mode: "pointwise" }, inputs: ["E"] },
            {
              id: "G",
              type: "Agg",
              config: { mode: "pointwise", isSubscribed: true },
              inputs: ["F"]
            }
          ]
        })
      );

      await graph.execute();

      const state = graph.exportState();
      expect(state.nodes["D"].currentValue).toEqual([2]);
      expect(state.nodes["G"].currentValue).toEqual([2]);

      graph.destroy();
    });
  });

  // ============================================
  // Validation and Error Handling
  // ============================================

  describe("Validation and error handling", () => {
    it("throws if cycle is introduced", () => {
      expect(() => {
        createGraph(
          withNodesConfig({
            nodesPlugins: [staticNode, aggNode],
            nodes: [
              { id: "a", type: "Static", config: { value: 1 } },
              { id: "b", type: "Agg", config: {}, inputs: ["a"] },
              { id: "a2", type: "Agg", config: {}, inputs: ["b", "a2"] } // cycle: a2 -> a2
            ]
          })
        );
      }).toThrow();
    });

    it("throws if input node not found", () => {
      expect(() => {
        createGraph(
          withNodesConfig({
            nodesPlugins: [aggNode],
            nodes: [
              {
                id: "z",
                type: "Agg",
                config: { mode: "pointwise" },
                inputs: ["missing"]
              }
            ]
          })
        );
      }).toThrow("Input node 'missing' not found");
    });
  });

  // ============================================
  // INIT_NODE_EXEC Handling
  // ============================================

  describe("INIT_NODE_EXEC handling", () => {
    it("handles INIT_NODE_EXEC as initial value for nodes", async () => {
      const graph = createGraph(
        withNodesConfig({
          nodesPlugins: [staticNode],
          nodes: [
            { id: "a", type: "Static", config: { value: 42, isSubscribed: true } }
          ]
        })
      );

      await graph.execute();
      
      const observable = graph.observeNode("a");
      expect(observable).toBeDefined();
      
      const values: any[] = [];
      const subscription = observable!.subscribe(val => {
        values.push(val);
      });

      await new Promise(resolve => setTimeout(resolve, 50));
      subscription.unsubscribe();

      expect(values.length).toBeGreaterThan(0);
      expect(values[values.length - 1]).toBe(42);
      
      graph.destroy();
    });

    it("should skip INIT_NODE_EXEC for nodes with dependencies", async () => {
      const graph = createGraph(
        withNodesConfig({
          nodesPlugins: [staticNode, aggNode],
          nodes: [
            { id: "a", type: "Static", config: { value: [10] } },
            { id: "b", type: "Static", config: { value: [20] } },
            {
              id: "sum",
              type: "Agg",
              config: { mode: "pointwise", isSubscribed: true },
              inputs: ["a", "b"]
            }
          ]
        })
      );

      await graph.execute();

      const state = graph.exportState();
      expect(state.nodes["sum"].currentValue).toEqual([30]);
      graph.destroy();
    });
  });
});

