/**
 * Worker script for Node.js Worker Threads
 * 
 * This file is used by NodeWorkerContext for testing parallel execution.
 * It runs in a separate thread and processes messages from the main thread.
 */

const { parentPort, isMainThread, threadId } = require('worker_threads');

// Don't execute code if there's no parentPort (i.e. this is not a worker)
if (!parentPort) {
  throw new Error('This script can only be used as a worker thread');
}

// Thread information for debugging
const threadInfo = {
  isMainThread,
  threadId
};

console.log(`🧵 Worker initialized: threadId=${threadId}, isMainThread=${isMainThread}`);

// Plugins loaded in the worker
const plugins = new Map();

/**
 * Creates plugin for heavy computations
 * @returns {Object} - Plugin with compute method for heavy computations
 */
function createHeavyComputePlugin() {
  return {
    type: 'heavyCompute',
    compute: (config, inputs) => {
      const complexity = config.complexity || 10000;
      const nodeId = config.id || 'unknown';
      let value = 0;
      
      console.log(`🧵 Executing node ${nodeId} in thread: ${threadId}, isMainThread: ${isMainThread}`);
      
      // Optimized computation algorithm
      const chunkSize = 1000; // Computation chunk size
      const chunks = Math.ceil(complexity / chunkSize);
      
      const startTime = process.hrtime.bigint();
      
      for (let chunk = 0; chunk < chunks; chunk++) {
        const start = chunk * chunkSize;
        const end = Math.min(start + chunkSize, complexity);
        
        for (let i = start; i < end; i++) {
          // Optimized computations
          const x = i * 0.0001;
          value = Math.sin(value + x) + Math.sqrt(Math.abs(Math.cos(i * 0.01)));
          
          // Additional complexity with lower frequency for optimization
          if (i % 500 === 0) {
            const sinValue = Math.sin(i);
            const cosValue = Math.cos(i);
            value += Math.pow(sinValue, 2) + Math.pow(cosValue, 2);
          }
        }
      }
      
      const endTime = process.hrtime.bigint();
      const executionTime = Number(endTime - startTime) / 1000000; // in milliseconds
      
      console.log(`🧵 Node ${nodeId} completed computations in ${executionTime.toFixed(2)}ms`);
      
      return { 
        result: value, 
        nodeId: nodeId,
        complexity,
        executionTime,
        threadInfo: {
          isMainThread,
          threadId
        }
      };
    }
  };
}

/**
 * Creates plugin for image processing
 * @returns {Object} - Plugin with compute method for image processing
 */
function createImageProcessingPlugin() {
  return {
    type: 'imageProcessing',
    compute: (config, inputs) => {
      const nodeId = config.id || 'unknown';
      const operation = config.operation || 'blur';
      
      console.log(`🧵 Executing imageProcessing: ${nodeId} in thread: ${threadId}`);
      
      let imageData = null;
      
      // Get image data from inputs
      if (inputs && inputs.length > 0) {
        if (inputs[0] && typeof inputs[0] === 'object') {
          imageData = inputs[0];
        }
      }
      
      // Simulate image processing
      const startTime = process.hrtime.bigint();
      
      // Simulate image processing of different complexity
      let processingTime = 50; // milliseconds
      if (operation === 'blur') processingTime = 100;
      if (operation === 'sharpen') processingTime = 150;
      if (operation === 'colorAdjust') processingTime = 200;
      
      // Simulate processing delay
      const wait = (ms) => {
        const start = Date.now();
        while (Date.now() - start < ms) {}
      };
      
      wait(processingTime);
      
      const endTime = process.hrtime.bigint();
      const executionTime = Number(endTime - startTime) / 1000000; // in milliseconds
      
      const processedData = { 
        processed: true, 
        operation,
        width: imageData?.width || 100,
        height: imageData?.height || 100
      };
      
      return {
        result: processedData,
        nodeId,
        operation,
        executionTime,
        threadInfo: {
          isMainThread,
          threadId
        }
      };
    }
  };
}

/**
 * Creates plugin for text analysis
 * @returns {Object} - Plugin with compute method for text analysis
 */
function createTextAnalysisPlugin() {
  return {
    type: 'textAnalysis',
    compute: (config, inputs) => {
      const nodeId = config.id || 'unknown';
      
      console.log(`🧵 Executing textAnalysis: ${nodeId} in thread: ${threadId}`);
      
      let text = '';
      
      // Get text from inputs
      if (inputs && inputs.length > 0) {
        if (typeof inputs[0] === 'string') {
          text = inputs[0];
        } else if (inputs[0] && inputs[0].text) {
          text = inputs[0].text;
        }
      }
      
      const startTime = process.hrtime.bigint();
      
      // Real text analysis (simple example)
      const wordCount = text.split(/\s+/).filter(word => word.length > 0).length;
      const charCount = text.length;
      const sentenceCount = text.split(/[.!?]+/).filter(s => s.trim().length > 0).length;
      
      // Calculate word frequency
      const wordFrequency = {};
      text.split(/\s+/).filter(word => word.length > 0).forEach(word => {
        const cleanWord = word.toLowerCase().replace(/[^a-z]/gi, '');
        if (cleanWord) {
          wordFrequency[cleanWord] = (wordFrequency[cleanWord] || 0) + 1;
        }
      });
      
      const endTime = process.hrtime.bigint();
      const executionTime = Number(endTime - startTime) / 1000000; // in milliseconds
      
      return {
        result: {
          wordCount,
          charCount,
          sentenceCount,
          wordFrequency: Object.entries(wordFrequency)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10), // top-10 words
          analyzed: true
        },
        nodeId,
        executionTime,
        threadInfo: {
          isMainThread,
          threadId
        }
      };
    }
  };
}

// Register standard plugins
plugins.set('heavyCompute', createHeavyComputePlugin());
plugins.set('imageProcessing', createImageProcessingPlugin());
plugins.set('textAnalysis', createTextAnalysisPlugin());

// Handle messages from main thread
parentPort.on('message', async (message) => {
  try {
    const { id, type, nodeType, config, inputs } = message;
    
    if (type === 'compute') {
      console.log(`🧵 Worker ${threadId} received task: ${nodeType}`);
      
      try {
        // Get registered plugin or create mock
        let plugin = plugins.get(nodeType);
        
        if (!plugin) {
          // Create simple plugin implementation by type
          plugin = {
            type: nodeType,
            compute: (pluginConfig, pluginInputs) => {
              // Basic plugin just returns structure with thread information
              return { 
                result: 'worker_result', 
                inputs: pluginInputs, 
                config: pluginConfig,
                type: nodeType,
                threadInfo: {
                  isMainThread,
                  threadId
                }
              };
            }
          };
        }
        
        // Measure execution time
        const startTime = process.hrtime.bigint();
        
        // Execute computation using plugin
        let result = plugin.compute(config, inputs);
        
        // If result is Promise, wait for it to complete
        if (result instanceof Promise) {
          result = await result;
        }
        
        const endTime = process.hrtime.bigint();
        const executionTime = Number(endTime - startTime) / 1000000; // in milliseconds
        
        // Add execution time information to result if not already present
        if (result && typeof result === 'object' && !result.executionTime) {
          result.executionTime = executionTime;
        }
        
        console.log(`🧵 Worker ${threadId} completed task: ${nodeType} in ${executionTime.toFixed(2)}ms`);
        
        // Send result back
        parentPort.postMessage({
          id,
          type: 'result',
          data: result
        });
      } catch (computeError) {
        console.error(`🧵 Error in worker ${threadId}:`, computeError);
        parentPort.postMessage({
          id,
          type: 'error',
          data: computeError.message || String(computeError)
        });
      }
    } else if (type === 'register_plugin') {
      const { pluginType } = message;
      
      // Register plugin if not already registered
      if (!plugins.has(pluginType)) {
        console.log(`🧵 Worker ${threadId} registering plugin ${pluginType}`);
        
        // In real implementation this could import a module
        // In this case just create a basic plugin
        plugins.set(pluginType, {
          type: pluginType,
          compute: (pluginConfig, pluginInputs) => {
            return { 
              result: `${pluginType}_result`, 
              threadInfo: {
                isMainThread,
                threadId
              }
            };
          }
        });
      }
      
      // Send registration confirmation
      parentPort.postMessage({
        id,
        type: 'plugin_registered',
        data: { pluginType }
      });
    }
  } catch (error) {
    console.error(`🧵 Critical error in worker ${threadId}:`, error);
    parentPort.postMessage({
      id: message.id,
      type: 'error',
      data: error.message || String(error)
    });
  }
}); 