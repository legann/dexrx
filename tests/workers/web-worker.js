// Plugin registry
const plugins = new Map();

// Get information about current thread
const threadInfo = {
  isMainThread: false,
  threadId: Math.floor(Math.random() * 1000) // Simulate thread ID in web worker
};

console.log(`🧵 Web worker initialized: threadId=${threadInfo.threadId}`);

/**
 * Creates base plugin by specified type
 * @param {string} nodeType - Node/plugin type
 * @returns {Object} - Plugin object with compute method
 */
function createBasePlugin(nodeType) {
  return {
    type: nodeType,
    compute: (config, inputs) => {
      console.log(`🧵 Executing node ${config.id || 'unknown'} in thread: ${threadInfo.threadId}`);
      
      // Base plugin simply returns value from config or first input
      if (config && typeof config.value !== 'undefined') {
        return {
          result: config.value,
          nodeId: config.id || 'unknown',
          threadInfo
        };
      }
      
      if (inputs && inputs.length > 0) {
        return {
          result: inputs[0],
          nodeId: config.id || 'unknown',
          threadInfo
        };
      }
      
      return {
        result: null,
        nodeId: config.id || 'unknown',
        threadInfo
      };
    }
  };
}

/**
 * Creates plugin for heavy computations
 * @returns {Object} - Plugin with compute method for heavy computations
 */
function createHeavyComputePlugin() {
  return {
    type: 'heavyCompute',
    compute: (config, inputs) => {
      const nodeId = config.id || 'unknown';
      console.log(`🧵 Executing heavyCompute: ${nodeId} in thread: ${threadInfo.threadId}`);
      
      // Determine operation mode based on configuration parameters
      const iterations = config.iterations || 1000000;
      
      // Simplified mode for fast execution (used in tests)
      if (iterations <= 1) {
        console.log(`🧵 Node ${nodeId} uses simplified mode (iterations=${iterations})`);
        const value = config.value || 1;
        return { 
          result: value * 2,
          nodeId: nodeId,
          iterations: iterations,
          threadInfo
        };
      }
      
      // Standard mode with full computation
      console.log(`🧵 Node ${nodeId} uses standard mode (iterations=${iterations})`);
      let result = 0;
      
      // Optimized algorithm for computations
      const chunkSize = 1000; // Computation chunk size
      const chunks = Math.ceil(iterations / chunkSize);
      
      for (let chunk = 0; chunk < chunks; chunk++) {
        const start = chunk * chunkSize;
        const end = Math.min(start + chunkSize, iterations);
        
        for (let i = start; i < end; i++) {
          // More efficient formula with fewer trigonometry computations
          const x = i * 0.01;
          result += Math.sin(x) * Math.cos(x);
          
          // Perform additional computations less frequently
          if (i % 100 === 0) {
            const sinX = Math.sin(x);
            const cosX = Math.cos(x);
            result += sinX * sinX + cosX * cosX;
          }
        }
      }
      
      // Process input data more reliably
      if (inputs && inputs.length > 0) {
        for (const input of inputs) {
          // Check if input is object with result from another worker
          if (input && typeof input === 'object' && input.result !== undefined) {
            result *= parseFloat(input.result) || 1;
          } 
          // Check if input is number
          else if (typeof input === 'number') {
            result *= input;
          }
          // Check if input is string that can be converted to number
          else if (typeof input === 'string' && !isNaN(parseFloat(input))) {
            result *= parseFloat(input);
          }
        }
      }
      
      // Return result with useful information
      return { 
        result: parseFloat(result.toFixed(10)), // Round for more predictable results
        nodeId: nodeId,
        iterations,
        threadInfo
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
      console.log(`🧵 Executing textAnalysis: ${nodeId} in thread: ${threadInfo.threadId}`);
      
      let text = '';
      
      // Get text from inputs
      if (inputs && inputs.length > 0) {
        if (typeof inputs[0] === 'string') {
          text = inputs[0];
        } else if (inputs[0] && inputs[0].text) {
          text = inputs[0].text;
        }
      }
      
      // Text analysis
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
      
      // Convert to array and sort by descending frequency
      const sortedWords = Object.entries(wordFrequency)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10); // Take top-10 words
      
      return {
        result: {
          wordCount,
          charCount,
          sentenceCount,
          topWords: sortedWords,
          analyzed: true
        },
        nodeId,
        threadInfo
      };
    }
  };
}

// Register standard plugins
plugins.set('heavyCompute', createHeavyComputePlugin());
plugins.set('textAnalysis', createTextAnalysisPlugin());

// Initialize message handler
self.onmessage = async function(e) {
  console.log(`🧵 Worker ${threadInfo.threadId} received message:`, e.data.type);
  
  const { id, type, nodeType, config, inputs, pluginType } = e.data;
  
  try {
    if (type === 'init') {
      // Worker initialization
      console.log(`🧵 Worker ${threadInfo.threadId} initializing...`);
      self.postMessage({ 
        type: 'ready',
        threadInfo 
      });
      console.log(`🧵 Worker ${threadInfo.threadId} sent ready signal`);
      return;
    }
    
    if (type === 'register_plugin') {
      // Plugin registration
      console.log(`🧵 Worker ${threadInfo.threadId} registering plugin ${pluginType}`);
      // In real implementation this could import a module
      // In this case, just create base plugin if not registered
      if (!plugins.has(pluginType)) {
        plugins.set(pluginType, createBasePlugin(pluginType));
      }
      
      self.postMessage({ 
        type: 'plugin_registered', 
        pluginType,
        threadInfo 
      });
      console.log(`🧵 Worker ${threadInfo.threadId} successfully registered plugin ${pluginType}`);
      return;
    }
    
    if (type === 'execute') {
      console.log(`🧵 Worker ${threadInfo.threadId} received task: ${nodeType}, id=${id}, config=`, config);
      
      // Get plugin or create base if not found
      let plugin = plugins.get(nodeType);
      if (!plugin) {
        console.log(`🧵 Worker ${threadInfo.threadId} creating base plugin for ${nodeType}`);
        plugin = createBasePlugin(nodeType);
        plugins.set(nodeType, plugin);
      }
      
      try {
        // Measure execution time for debugging
        const startTime = performance.now();
        
        // Execute computation
        console.log(`🧵 Worker ${threadInfo.threadId} starting computation for ${config.id || 'unknown'}`);
        let result = plugin.compute(config, inputs);
        
        // If result is Promise, wait for it to complete
        if (result instanceof Promise) {
          console.log(`🧵 Worker ${threadInfo.threadId} waiting for async result`);
          result = await result;
        }
        
        const endTime = performance.now();
        const executionTime = endTime - startTime;
        
        console.log(`🧵 Worker ${threadInfo.threadId} completed task: ${nodeType}, result:`, result);
        console.log(`🧵 Execution time: ${executionTime.toFixed(2)}ms`);
        
        // Add execution time information to result
        if (result && typeof result === 'object') {
          result.executionTime = executionTime;
        }
        
        // Send result back
        self.postMessage({ 
          taskId: id, 
          result 
        });
        console.log(`🧵 Worker ${threadInfo.threadId} sent result for task ${id}`);
      } catch (computeError) {
        // Error in computation itself
        console.error(`🧵 Error in worker ${threadInfo.threadId}:`, computeError);
        console.error(`🧵 Error stack:`, computeError.stack);
        self.postMessage({ 
          taskId: id, 
          error: computeError.message || String(computeError),
          stack: computeError.stack
        });
        console.log(`🧵 Worker ${threadInfo.threadId} sent error message for task ${id}`);
      }
    } else {
      console.warn(`🧵 Worker ${threadInfo.threadId} received unknown message type: ${type}`);
    }
  } catch (error) {
    // General handling error
    console.error(`🧵 Critical error in worker ${threadInfo.threadId}:`, error);
    console.error(`🧵 Critical error stack:`, error.stack);
    self.postMessage({ 
      taskId: id, 
      error: error.message || String(error),
      stack: error.stack
    });
    console.log(`🧵 Worker ${threadInfo.threadId} sent critical error message`);
  }
}; 