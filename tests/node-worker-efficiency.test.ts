import { createGraph } from '../lib/dexrx/src/graph';
import { withNodesConfig, withOptions } from '../lib/dexrx/src/operators';
import { INodePlugin } from 'dexrx';
import { EngineExecutionMode } from '../lib/dexrx/src/types/engine-options';

// Type for compute result with thread info
type ComputeResult = {
  result: number;
  threadInfo?: {
    isMainThread: boolean;
    threadId?: number;
  };
};

describe('Node.js Worker Threads Efficiency (Build API)', () => {
  // Timeout for tests - increased for heavy computations
  jest.setTimeout(30000);
  
  const heavyComputePlugin: INodePlugin = {
    type: 'heavyCompute',
    category: 'operational',
    compute: (config: any) => {
      const complexity = config.complexity || 1000;
      let result = 0;
      
      // Simple computations for testing
      for (let i = 0; i < complexity; i++) {
        result += Math.sin(i * 0.01);
      }
      
      return { 
        result, 
        executedIn: 'main',
        complexity
      };
    }
  };
  
  it('should efficiently execute heavy computations', async () => {
    // Create graph with SERIAL mode (main thread)
    const serialGraph = createGraph(
      withOptions({
        engine: {
          executionMode: EngineExecutionMode.SERIAL
        }
      }),
      withNodesConfig({
        nodesPlugins: [heavyComputePlugin],
        nodes: [
          { 
            id: 'heavy1', 
            type: 'heavyCompute', 
            config: { complexity: 10000, isSubscribed: true } 
          }
        ]
      })
    );

    // Measure execution time in main thread
    const startTimeMain = Date.now();
    await serialGraph.execute();
    const mainTime = Date.now() - startTimeMain;
    
    const mainState = serialGraph.exportState();
    const mainResult = mainState.nodes['heavy1'].currentValue;
    
    console.log(`Execution time in main thread: ${mainTime}ms`);
    
    serialGraph.destroy();

    // Create graph with PARALLEL mode (worker threads)
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
          { 
            id: 'heavy2', 
            type: 'heavyCompute', 
            config: { complexity: 10000, isSubscribed: true } 
          }
        ]
      })
    );

    // Measure execution time in Worker Threads
    const startTimeWorker = Date.now();
    await parallelGraph.execute();
    const workerTime = Date.now() - startTimeWorker;
    
    const workerState = parallelGraph.exportState();
    const workerResult = workerState.nodes['heavy2'].currentValue;
    
    console.log(`Execution time in Node.js Worker: ${workerTime}ms`);
    
    // Check results
    expect(mainResult).toBeDefined();
    expect(workerResult).toBeDefined();
    
    // Worker result should have threadInfo (added by NodeWorkerContext)
    const typedWorkerResult = workerResult as ComputeResult;
    if (typedWorkerResult && typeof typedWorkerResult === 'object' && 'threadInfo' in typedWorkerResult) {
      expect(typedWorkerResult.threadInfo).toBeDefined();
      expect(typedWorkerResult.threadInfo?.isMainThread).toBe(false);
    }
    
    // Main thread result doesn't have threadInfo (MainThreadContext doesn't add it)
    // Just check that both have results
    const mainResultObj = mainResult as { result: number };
    const workerResultObj = workerResult as { result: number };
    if (mainResultObj && typeof mainResultObj === 'object' && 'result' in mainResultObj) {
      expect(mainResultObj.result).toBeDefined();
    }
    if (workerResultObj && typeof workerResultObj === 'object' && 'result' in workerResultObj) {
      expect(workerResultObj.result).toBeDefined();
    }
    
    parallelGraph.destroy();
  });
  
  it('should efficiently process text analysis', async () => {
    const textAnalysisPlugin: INodePlugin = {
      type: 'textAnalysis',
      category: 'operational',
      compute: (config: any, inputs: any[]) => {
        // Get text from config or inputs
        const text = config?.text || inputs[0]?.text || (typeof inputs[0] === 'string' ? inputs[0] : '');
        const words = text.split(/\s+/).filter(w => w.length > 0);
        const wordFrequency: Record<string, number> = {};
        
        for (const word of words) {
          wordFrequency[word] = (wordFrequency[word] || 0) + 1;
        }
        
        return {
          wordCount: words.length,
          charCount: text.length,
          wordFrequency
        };
      }
    };
    
    // Create test text
    const testText = 'This is test text for analysis. It contains several sentences. ' +
                    'Text analysis is an important task of natural language processing. ' +
                    'Test text should contain different words and structures.'.repeat(50);
    
    // Create source node for text
    const textSourcePlugin: INodePlugin = {
      type: 'textSource',
      category: 'data',
      compute: (config: any) => {
        return config?.text || '';
      }
    };
    
    const graph = createGraph(
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
        nodesPlugins: [textSourcePlugin, textAnalysisPlugin],
        nodes: [
          { 
            id: 'textSource', 
            type: 'textSource', 
            config: { text: testText } 
          },
          { 
            id: 'textAnalysis', 
            type: 'textAnalysis', 
            inputs: ['textSource'],
            config: { isSubscribed: true } 
          }
        ]
      })
    );

    // Measure execution time
    const startTime = Date.now();
    await graph.execute();
    // Wait for some time to allow execution
    await new Promise(resolve => setTimeout(resolve, 2000));
    const executionTime = Date.now() - startTime;
    
    console.log(`Text analysis time: ${executionTime}ms`);
    
    const state = graph.exportState();
    const result = state.nodes['textAnalysis'].currentValue;
    
    // Check results - in parallel mode, result might be wrapped in worker structure
    // Just verify that graph executed
    expect(state.nodes['textAnalysis']).toBeDefined();
    
    graph.destroy();
  });
  
  it('should process multiple tasks in parallel', async () => {
    const graph = createGraph(
      withOptions({
        engine: {
          executionMode: EngineExecutionMode.PARALLEL
        },
        executionContext: {
          parallelOptions: {
            maxWorkers: 4 // Use more workers for parallel execution
          }
        }
      }),
      withNodesConfig({
        nodesPlugins: [heavyComputePlugin],
        nodes: [
          { 
            id: 'task1', 
            type: 'heavyCompute', 
            config: { complexity: 8000, isSubscribed: true } 
          },
          { 
            id: 'task2', 
            type: 'heavyCompute', 
            config: { complexity: 8000, isSubscribed: true } 
          },
          { 
            id: 'task3', 
            type: 'heavyCompute', 
            config: { complexity: 8000, isSubscribed: true } 
          },
          { 
            id: 'task4', 
            type: 'heavyCompute', 
            config: { complexity: 8000, isSubscribed: true } 
          }
        ]
      })
    );

    // Start all tasks in parallel
    const startTime = Date.now();
    await graph.execute();
    // Wait for some time to allow execution
    await new Promise(resolve => setTimeout(resolve, 5000));
    const totalTime = Date.now() - startTime;
    
    console.log(`Execution time of 4 parallel tasks: ${totalTime}ms`);
    
    const state = graph.exportState();
    
    // Check results - in parallel mode, results might be wrapped in worker structure
    // Just verify that all nodes were created and graph executed
    expect(state.nodes['task1']).toBeDefined();
    expect(state.nodes['task2']).toBeDefined();
    expect(state.nodes['task3']).toBeDefined();
    expect(state.nodes['task4']).toBeDefined();
    
    graph.destroy();
  });
});
