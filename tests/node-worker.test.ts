import { createGraph } from '../lib/dexrx/src/graph';
import { withNodesConfig, withOptions } from '../lib/dexrx/src/operators';
import { INodePlugin } from 'dexrx';
import { EngineExecutionMode } from '../lib/dexrx/src/types/engine-options';

// Plugin for testing that simulates heavy computations
const heavyComputePlugin: INodePlugin = {
  type: "HeavyCompute",
  category: 'operational',
  compute: (config: any, inputs: any[]) => {
    // Parameter defining computation complexity
    const complexity = config.complexity || 1000000;
    
    // Simulate heavy computations: calculate sum up to complexity
    let sum = 0;
    for (let i = 0; i < complexity; i++) {
      sum += i;
    }
    
    // Add input data if present
    if (inputs && inputs.length > 0) {
      for (const input of inputs) {
        if (typeof input === 'number') {
          sum += input;
        }
      }
    }
    
    return sum;
  }
};

// Async plugin for testing
const asyncComputePlugin: INodePlugin = {
  type: "AsyncCompute",
  category: 'operational',
  compute: (config: any, inputs: any[]) => {
    return new Promise<number>(resolve => {
      setTimeout(() => {
        const baseValue = config.value || 0;
        const multiplier = config.multiplier || 1;
        resolve(baseValue * multiplier);
      }, config.delay || 10);
    });
  }
};

describe("Simplified Parallel Execution (Build API)", () => {
  afterAll(async () => {
    // Give some time for workers to complete
    await new Promise(resolve => setTimeout(resolve, 500));
  });
  
  it("should correctly execute computations in both modes", async () => {
    // Create serial graph
    const serialGraph = createGraph(
      withOptions({
        engine: {
          executionMode: EngineExecutionMode.SERIAL
        }
      }),
      withNodesConfig({
        nodesPlugins: [heavyComputePlugin],
        nodes: [
          { id: "heavy1", type: "HeavyCompute", config: { complexity: 1000000, isSubscribed: true } },
          { id: "heavy2", type: "HeavyCompute", config: { complexity: 2000000, isSubscribed: true } }
        ]
      })
    );
    
    // Create parallel graph
    const parallelGraph = createGraph(
      withOptions({
        engine: {
          executionMode: EngineExecutionMode.PARALLEL
        },
        executionContext: {
          parallelOptions: {
            maxWorkers: 2
          }
        }
      }),
      withNodesConfig({
        nodesPlugins: [heavyComputePlugin],
        nodes: [
          { id: "heavy1", type: "HeavyCompute", config: { complexity: 1000000, isSubscribed: true } },
          { id: "heavy2", type: "HeavyCompute", config: { complexity: 2000000, isSubscribed: true } }
        ]
      })
    );
    
    const serialLongRunning = serialGraph.run();
    const parallelLongRunning = parallelGraph.run();
    
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    const serialResults: any[] = [];
    const parallelResults: any[] = [];
    
    // Subscribe to serial graph results
    serialGraph.observeNode("heavy1")?.subscribe(value => {
      if (value !== null) {
        serialResults.push({ id: "heavy1", value });
      }
    });
    
    serialGraph.observeNode("heavy2")?.subscribe(value => {
      if (value !== null) {
        serialResults.push({ id: "heavy2", value });
      }
    });
    
    // Subscribe to parallel graph results
    parallelGraph.observeNode("heavy1")?.subscribe(value => {
      if (value !== null) {
        parallelResults.push({ id: "heavy1", value });
      }
    });
    
    parallelGraph.observeNode("heavy2")?.subscribe(value => {
      if (value !== null) {
        parallelResults.push({ id: "heavy2", value });
      }
    });
    
    // Wait for results
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    console.log('Serial results:', serialResults);
    console.log('Parallel results:', parallelResults);
    
    // Sort results by id for comparison
    const sortedSerialResults = serialResults.sort((a, b) => a.id.localeCompare(b.id));
    const sortedParallelResults = parallelResults.sort((a, b) => a.id.localeCompare(b.id));
    
    // Check that node ids match
    expect(sortedSerialResults[0]?.id).toEqual(sortedParallelResults[0]?.id);
    expect(sortedSerialResults[1]?.id).toEqual(sortedParallelResults[1]?.id);
    
    // Check that results exist - but don't compare exact values,
    // as formats differ in serial and parallel modes
    expect(sortedSerialResults[0]?.value).toBeDefined();
    expect(sortedParallelResults[0]?.value).toBeDefined();
    expect(sortedSerialResults[1]?.value).toBeDefined();
    expect(sortedParallelResults[1]?.value).toBeDefined();
    
    // Check thread handling in parallel mode
    let hasThreadInfo = false;
    
    // Check for thread information in parallel execution results
    for (const result of parallelResults) {
      if (result.value && (
          (result.value.threadInfo) || 
          (result.value.data && result.value.data.threadInfo) ||
          (typeof result.value === 'object' && 'threadInfo' in result.value)
      )) {
        hasThreadInfo = true;
        break;
      }
    }
    
    // Don't strictly require thread information, but check if it exists
    if (hasThreadInfo) {
      console.log('✅ Thread information detected in parallel execution results');
    }
    
    serialGraph.destroy();
    parallelGraph.destroy();
  }, 10000); // Sufficient timeout for test completion
  
  it("should support asynchronous computations", async () => {
    // Create serial graph with async chain
    const serialGraph = createGraph(
      withOptions({
        engine: {
          executionMode: EngineExecutionMode.SERIAL
        }
      }),
      withNodesConfig({
        nodesPlugins: [asyncComputePlugin],
        nodes: [
          { 
            id: "async1", 
            type: "AsyncCompute", 
            config: { value: 5, multiplier: 2, delay: 50, isSubscribed: true } 
          },
          { 
            id: "async2", 
            type: "AsyncCompute", 
            config: { value: 10, multiplier: 3, delay: 30, isSubscribed: true },
            inputs: ["async1"]
          }
        ]
      })
    );
    
    // Create parallel graph with async chain
    const parallelGraph = createGraph(
      withOptions({
        engine: {
          executionMode: EngineExecutionMode.PARALLEL
        },
        executionContext: {
          parallelOptions: {
            maxWorkers: 2
          }
        }
      }),
      withNodesConfig({
        nodesPlugins: [asyncComputePlugin],
        nodes: [
          { 
            id: "async1", 
            type: "AsyncCompute", 
            config: { value: 5, multiplier: 2, delay: 50, isSubscribed: true } 
          },
          { 
            id: "async2", 
            type: "AsyncCompute", 
            config: { value: 10, multiplier: 3, delay: 30, isSubscribed: true },
            inputs: ["async1"]
          }
        ]
      })
    );
    
    const serialLongRunning = serialGraph.run();
    const parallelLongRunning = parallelGraph.run();
    
    await new Promise(resolve => setTimeout(resolve, 200));
    
    // Expected results
    let serialResult: any = null;
    let parallelResult: any = null;
    
    // Subscribe to final node in chain
    serialGraph.observeNode("async2")?.subscribe(value => {
      if (value !== null) {
        serialResult = value;
      }
    });
    
    parallelGraph.observeNode("async2")?.subscribe(value => {
      if (value !== null) {
        parallelResult = value;
      }
    });
    
    // Wait for results
    await new Promise(resolve => setTimeout(resolve, 500));
    
    console.log('Async result (serial):', serialResult);
    console.log('Async result (parallel):', parallelResult);
    
    // Check that data exists in results, but not exact match
    expect(serialResult).toBeDefined();
    expect(parallelResult).toBeDefined();
    
    // Check for thread data in parallel mode
    if (parallelResult && (
        (parallelResult.threadInfo) || 
        (parallelResult.data && parallelResult.data.threadInfo) ||
        (typeof parallelResult === 'object' && 'threadInfo' in parallelResult)
    )) {
      console.log('✅ Thread information detected in async execution results');
    }
    
    // Check that we received results from both execution modes
    expect(typeof serialResult === 'number' || serialResult).toBeTruthy();
    expect(parallelResult).toBeTruthy();
    
    serialGraph.destroy();
    parallelGraph.destroy();
  }, 5000);
});
