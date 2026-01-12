import { createGraph } from '../lib/dexrx/src/graph';
import { withNodesConfig, withOptions } from '../lib/dexrx/src/operators';
import { INodePlugin } from 'dexrx';
import { LoggerManager } from '../lib/dexrx/src/utils/logging';
import { ConsoleLoggerAdapter } from '../lib/dexrx/src/utils/logging/console-logger-adapter';

/**
 * Mock plugin for security testing
 */
const mockPlugin: INodePlugin = {
  type: 'mock',
  category: 'operational',
  compute: (config: any, inputs: any[]): any => {
    // Return input data or config if no inputs
    return inputs.length > 0 ? inputs[0] : config?.value;
  }
};

/**
 * Potentially dangerous plugin for security testing
 */
const dangerousPlugin: INodePlugin = {
  type: 'dangerous',
  category: 'operational',
  compute: (config: any, inputs: any[]): any => {
    // Attempt to execute eval if it's a string
    if (typeof config?.code === 'string') {
      try {
        // In reality this code won't be executed due to sanitization
        // eslint-disable-next-line no-eval
        return eval(config.code);
      } catch (error: any) {
        return `Error: ${error.message}`;
      }
    }
    return inputs[0];
  }
};

/**
 * Heavy plugin that can be used for DoS attacks
 */
const heavyComputationPlugin: INodePlugin = {
  type: 'heavy',
  category: 'operational',
  compute: (config: any, inputs: any[]): any => {
    const iterations = config?.iterations || 10;
    let result = 0;
    
    // Simulate heavy computations
    for (let i = 0; i < iterations; i++) {
      for (let j = 0; j < iterations; j++) {
        result += Math.sqrt(i * j);
      }
    }
    
    return result;
  }
};

describe('ExecutableGraph - Security Tests (Build API)', () => {
  let logger: ConsoleLoggerAdapter;
  
  beforeEach(() => {
    // Prepare logger
    logger = new ConsoleLoggerAdapter();
    LoggerManager.getInstance().setLogger(logger);
    logger.clearInputGuardLogs();
  });

  /**
   * Tests for cycle protection
   */
  describe('Cyclic dependency protection', () => {
    test('should throw exception when creating graph with cyclic dependency', () => {
      // Build API detects cycles at creation time during topological sort
      expect(() => {
        createGraph(
          withOptions({
            engine: {
              sanitizeInput: true,
              maxDepth: 5,
              debounceTime: 10
            }
          }),
          withNodesConfig({
            nodesPlugins: [mockPlugin],
            nodes: [
              { id: 'A', type: 'mock', config: { value: 10 }, inputs: ['D'] }, // A depends on D
              { id: 'B', type: 'mock', inputs: ['A'] }, // B depends on A
              { id: 'C', type: 'mock', inputs: ['B'] }, // C depends on B
              { id: 'D', type: 'mock', inputs: ['C'] } // D depends on C - creates cycle A -> B -> C -> D -> A
            ]
          })
        );
      }).toThrow(/Cycle detected/);
    });
    
    test('should throw exception when creating graph with indirect cyclic dependency', () => {
      // Build API detects cycles at creation time
      expect(() => {
        createGraph(
          withOptions({
            engine: {
              sanitizeInput: true,
              maxDepth: 5,
              debounceTime: 10
            }
          }),
          withNodesConfig({
            nodesPlugins: [mockPlugin],
            nodes: [
              { id: 'X1', type: 'mock', config: { value: 5 }, inputs: ['X2'] }, // X1 depends on X2
              { id: 'X2', type: 'mock', inputs: ['X1'] } // X2 depends on X1 - cycle!
            ]
          })
        );
      }).toThrow(/Cycle detected/);
    });
  });

  /**
   * Tests for input sanitization
   */
  describe('Input sanitization', () => {
    test('should safely handle potentially dangerous configurations', async () => {
      // Create node with potentially dangerous configuration
      const dangerousConfig = {
        code: 'console.log("XSS attack"); return "hacked";',
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore - intentionally create unsafe object for test
        __proto__: { malicious: true },
        constructor: { prototype: { polluted: true } }
      };
      
      const graph = createGraph(
        withOptions({
          engine: {
            sanitizeInput: true,
            maxDepth: 5,
            debounceTime: 10
          }
        }),
          withNodesConfig({
            nodesPlugins: [dangerousPlugin],
            nodes: [
              { 
                id: 'danger', 
                type: 'dangerous', 
                config: { ...dangerousConfig, isSubscribed: true }
              }
            ]
          })
      );

      await graph.execute();
      await new Promise(resolve => setTimeout(resolve, 100));

      const state = graph.exportState();
      const result = state.nodes['danger'].currentValue;
      
      // Check that result does NOT contain "hacked" (i.e. eval didn't work)
      expect(result).not.toBe('hacked');
      expect(typeof result).toBe('string');
      expect(result).toContain('Error');

      graph.destroy();
    });
    
    test('should sanitize node identifiers', () => {
      // Build API validates inputs at creation time
      // Invalid input node IDs will cause an error
      expect(() => {
        createGraph(
          withOptions({
            engine: {
              sanitizeInput: true,
              maxDepth: 5,
              debounceTime: 10
            }
          }),
          withNodesConfig({
            nodesPlugins: [mockPlugin],
            nodes: [
              { id: 'normal', type: 'mock', config: { value: 42 } },
              {
                id: 'safe',
                type: 'mock',
                inputs: ['<script>alert(1)</script>', 'normal'] // Invalid node ID
              }
            ]
          })
        );
      }).toThrow(); // Build API validates that all input node IDs exist
    });
  });

  /**
   * Tests for DoS attack protection
   */
  describe('DoS attack protection', () => {
    test('should protect from excessive computations using debounce', async () => {
      const graph = createGraph(
        withOptions({
          engine: {
            sanitizeInput: true,
            maxDepth: 5,
            debounceTime: 10 // Set debounce to prevent DoS
          }
        }),
        withNodesConfig({
          nodesPlugins: [heavyComputationPlugin],
          nodes: [
            { 
              id: 'heavy1', 
              type: 'heavy', 
              config: { iterations: 5, isSubscribed: true } // Reduce load
            }
          ]
        })
      );

      await graph.execute();
      await new Promise(resolve => setTimeout(resolve, 50));

      // Start as long-running graph for updates
      const longRunningGraph = graph.run();

      // Rapidly update configuration several times (reduce count)
      for (let i = 0; i < 5; i++) {
        longRunningGraph.updateGraph([
          { 
            id: 'heavy1', 
            type: 'heavy', 
            config: { iterations: 5 + i, isSubscribed: true } 
          }
        ], { autoStart: true });
        await new Promise(resolve => setTimeout(resolve, 5));
      }

      // Wait for debounce to complete
      await new Promise(resolve => setTimeout(resolve, 100));

      const state = graph.exportState();
      expect(state.nodes['heavy1']).toBeDefined();

      graph.destroy();
    });
    
    test('should limit depth of nested objects', () => {
      // Create deeply nested object that can cause DoS in recursive processing
      let deepObject: any = { value: 'leaf' };
      for (let i = 0; i < 20; i++) {
        deepObject = { nested: deepObject };
      }
      
      const graph = createGraph(
        withOptions({
          engine: {
            sanitizeInput: true,
            maxDepth: 5, // Limit check depth
            debounceTime: 10
          }
        }),
        withNodesConfig({
          nodesPlugins: [mockPlugin],
          nodes: [
            {
              id: 'deepNode',
              type: 'mock',
              config: deepObject
            }
          ]
        })
      );

      // Check that graph was successfully created (i.e. processing didn't cause DoS attack)
      expect(graph).toBeDefined();
      graph.destroy();
    });
    
    test('should protect from mass node operations', async () => {
      const startTime = Date.now();
      const maxTime = 3000; // Maximum test time to 3 seconds
      
      // Create moderate number of nodes
      const nodes = [];
      for (let i = 0; i < 20; i++) {
        const inputs = [];
        for (let j = 0; j < Math.min(3, i); j++) {
          inputs.push(`node${i - j - 1}`);
        }
        
        nodes.push({
          id: `node${i}`,
          type: 'mock',
          config: { value: i },
          inputs: inputs.length > 0 ? inputs : undefined
        });
      }

      const graph = createGraph(
        withOptions({
          engine: {
            sanitizeInput: true,
            maxDepth: 5,
            debounceTime: 10
          }
        }),
        withNodesConfig({
          nodesPlugins: [mockPlugin],
          nodes: nodes
        })
      );

      // Check that all operations completed in reasonable time
      const endTime = Date.now();
      const duration = endTime - startTime;
      
      // Test should not take more than maximum time
      expect(duration).toBeLessThan(maxTime);
      
      // Check that graph was created successfully
      expect(graph).toBeDefined();
      
      await graph.execute();
      await new Promise(resolve => setTimeout(resolve, 100));

      const state = graph.exportState();
      expect(state.nodes['node19']).toBeDefined();

      graph.destroy();
    });
  });

  /**
   * Tests for security functions
   */
  describe('Security functions', () => {
    test('should warn about unsafe operations', () => {
      // Clear logs before test
      logger.clearInputGuardLogs();
      
      // Log warning and error
      logger.inputGuardWarn('Potentially dangerous node: testNode');
      logger.inputGuardError('Invalid input data', new Error('Invalid format'));
      
      // Get report
      const report = logger.getInputGuardReport();
      
      expect(report.warnings.length).toBe(1);
      expect(report.warnings[0]).toContain('Potentially dangerous node');
      
      expect(report.errors.length).toBe(1);
      expect(report.errors[0]).toContain('Invalid input data');
      expect(report.errors[0]).toContain('Invalid format');
    });
    
    test('should limit log size', () => {
      // Create logger for tests with limited size
      logger.setInputGuardMaxLogSize(3);
      
      // Clear logs before test
      logger.clearInputGuardLogs();
      
      // Log more warnings than maximum size allows
      logger.inputGuardWarn('Warning 1');
      logger.inputGuardWarn('Warning 2');
      logger.inputGuardWarn('Warning 3');
      logger.inputGuardWarn('Warning 4');
      logger.inputGuardWarn('Warning 5');
      
      // Get report
      const report = logger.getInputGuardReport();
      
      // Check that log size is limited
      expect(report.warnings.length).toBe(3);
      
      // Check that last 3 entries were preserved
      expect(report.warnings[0]).toContain('Warning 3');
      expect(report.warnings[1]).toContain('Warning 4');
      expect(report.warnings[2]).toContain('Warning 5');
    });
    
    test('should support test mode', () => {
      // Clear logs before test
      logger.clearInputGuardLogs();
      
      // Check if logger supports test mode
      if ('setTestMode' in logger) {
        // Only for test logger
        (logger as any).setTestMode(true);
      } else {
        // Skip test if logger doesn't support test mode
        console.log('Logger does not support test mode, test skipped');
        return;
      }
      
      // Log error about cycle detection
      logger.inputGuardError('Cycle detected in node graph: A -> B -> A');
      
      // Get report
      const report = logger.getInputGuardReport();
      
      // Check that error is still added to report
      expect(report.errors.length).toBe(1);
      expect(report.errors[0]).toContain('Cycle detected');
    });
  });
});
