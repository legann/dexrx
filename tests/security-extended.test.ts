import { createGraph } from '../lib/dexrx/src/graph';
import { withNodesConfig, withOptions } from '../lib/dexrx/src/operators';
import { INodePlugin } from 'dexrx';
import { LogLevel } from '../lib/dexrx/src/types/logger';
import { ConsoleLoggerAdapter } from '../lib/dexrx/src/utils/logging/console-logger-adapter';
import { EngineExecutionMode } from '../lib/dexrx/src/types/engine-options';

// Custom class for testing logger
class TestInputGuardLogger extends ConsoleLoggerAdapter {
  public warnings: string[] = [];
  public errors: string[] = [];
  private options: { enabled: boolean; maxLogEntries?: number } = { enabled: true };
  private eventLog: Array<{ type: string; message: string; level: string; timestamp: Date }> = [];
  
  constructor(options: { enabled: boolean; maxLogEntries?: number } = { enabled: true }) {
    super();
    this.options = options;
  }
  
  // Override inputGuardWarn for testing
  override inputGuardWarn(message: string, silent = false): void {
    if (!this.options.enabled) return;
    this.warnings.push(message);
    
    if (!silent) {
      // Call base method for logging to console
      super.inputGuardWarn(message, silent);
    }
  }
  
  // Override inputGuardError for testing
  override inputGuardError(message: string, error?: Error, silent = false): void {
    if (!this.options.enabled) return;
    this.errors.push(message);
    
    if (!silent) {
      // Call base method for logging to console
      super.inputGuardError(message, error, silent);
    }
  }
  
  // Replace clearInputGuardLogs
  override clearInputGuardLogs(): void {
    super.clearInputGuardLogs();
    this.warnings = [];
    this.errors = [];
    this.eventLog = [];
  }
  
  override setInputGuardMaxLogSize(size: number): void {
    super.setInputGuardMaxLogSize(size);
    this.options.maxLogEntries = size;
  }
  
  // Additional methods for testing
  testLog(type: string, message: string, level = 'info'): void {
    if (!this.options.enabled) return;
    
    this.eventLog.push({
      type,
      message,
      level,
      timestamp: new Date()
    });
    
    // Limit log size
    if (this.options.maxLogEntries && this.eventLog.length > this.options.maxLogEntries) {
      this.eventLog.shift();
    }
    
    // Log to console
    const logLevelMap: Record<string, LogLevel> = {
      'debug': LogLevel.DEBUG,
      'info': LogLevel.INFO,
      'warn': LogLevel.WARN,
      'error': LogLevel.ERROR
    };
    
    const logLevel = logLevelMap[level] || LogLevel.INFO;
    super.log(logLevel, `[${type}] ${message}`);
  }
  
  // New method adapting signature for compatibility with ConsoleLoggerAdapter
  override log(levelOrType: LogLevel | string, message: string, ...args: any[]): void {
    if (typeof levelOrType === 'string' && typeof message === 'string' && args.length === 0) {
      // Call from our method log(type, message, level)
      return;
    }
    
    // Call from base class
    if (typeof levelOrType === 'number') {
      super.log(levelOrType, message, ...args);
    }
  }
  
  getEventLog(): Array<{ type: string; message: string; level: string; timestamp: Date }> {
    return [...this.eventLog];
  }
  
  // Helper methods for checking content
  hasWarningWith(substring: string): boolean {
    return this.warnings.some(msg => msg.includes(substring));
  }
  
  hasErrorWith(substring: string): boolean {
    return this.errors.some(msg => msg.includes(substring));
  }
}

describe('Input validation tests (Build API)', () => {
  describe('Input validation and checking', () => {
    let testLogger: TestInputGuardLogger;

    beforeEach(() => {
      testLogger = new TestInputGuardLogger();
      testLogger.clearInputGuardLogs();
    });

    test('should register warnings and errors', () => {
      // Register warning and error
      testLogger.inputGuardWarn('Suspicious input: javascript:alert(1)');
      testLogger.inputGuardError('Invalid JSON format', new Error('Incorrect structure'));
      
      // Check that entries were added
      expect(testLogger.warnings.length).toBe(1);
      expect(testLogger.warnings[0]).toContain('Suspicious input');
      
      expect(testLogger.errors.length).toBe(1);
      expect(testLogger.errors[0]).toContain('Invalid JSON format');
      
      // Check report
      const report = testLogger.getInputGuardReport();
      expect(report.warnings.length).toBe(1);
      expect(report.errors.length).toBe(1);
    });

    test('should limit size of warnings and errors journal', () => {
      // Set maximum journal size
      testLogger.setInputGuardMaxLogSize(2);
      
      // Add more entries than allowed
      testLogger.inputGuardWarn('Warning 1');
      testLogger.inputGuardWarn('Warning 2');
      testLogger.inputGuardWarn('Warning 3');
      
      testLogger.inputGuardError('Error 1');
      testLogger.inputGuardError('Error 2');
      testLogger.inputGuardError('Error 3');
      
      // Get report
      const report = testLogger.getInputGuardReport();
      
      // Check that only last entries were saved
      expect(report.warnings.length).toBe(2);
      expect(report.warnings[0]).toContain('Warning 2');
      expect(report.warnings[1]).toContain('Warning 3');
      
      expect(report.errors.length).toBe(2);
      expect(report.errors[0]).toContain('Error 2');
      expect(report.errors[1]).toContain('Error 3');
    });
  });

  describe('Complex data processing', () => {
    const testPlugin: INodePlugin = {
      type: 'test',
      category: 'operational',
      compute: (config: any, inputs: any[]) => {
        // Simply return input data
        return { config, inputs };
      }
    };

    test('should safely handle deeply nested objects', () => {
      // Create deeply nested structure
      let deepObject: any = { value: 'leaf' };
      
      // Create deep chain of nested objects
      for (let i = 0; i < 15; i++) {
        deepObject = { next: deepObject };
      }
      
      const graph = createGraph(
        withOptions({
          engine: {
            sanitizeInput: true,  // Enable input sanitization
            maxDepth: 5,          // Limit check depth
            executionMode: EngineExecutionMode.SERIAL
          }
        }),
        withNodesConfig({
          nodesPlugins: [testPlugin],
          nodes: [
            {
              id: 'deepNode',
              type: 'test',
              config: deepObject
            }
          ]
        })
      );
      
      // Check that graph was successfully created
      expect(graph).toBeDefined();
      graph.destroy();
    });
  });
});

describe('Test logger - Extended tests', () => {
  describe('Event logging', () => {
    test('should log events', () => {
      const logger = new TestInputGuardLogger({ enabled: true });
      
      logger.testLog('access', 'Access to node node1');
      logger.testLog('validation', 'Invalid input', 'warn');
      logger.testLog('inputGuard', 'Injection attempt', 'error');
      
      const log = logger.getEventLog();
      expect(log.length).toBe(3);
      expect(log[0].type).toBe('access');
      expect(log[1].level).toBe('warn');
      expect(log[2].level).toBe('error');
    });

    test('should not log if logging is disabled', () => {
      const logger = new TestInputGuardLogger({ enabled: false });
      
      logger.testLog('access', 'Access to node node1');
      
      const log = logger.getEventLog();
      expect(log.length).toBe(0);
    });

    test('should respect log size limit', () => {
      const maxEntries = 2;
      const logger = new TestInputGuardLogger({ 
        enabled: true,
        maxLogEntries: maxEntries
      });
      
      logger.testLog('event1', 'Message 1');
      logger.testLog('event2', 'Message 2');
      logger.testLog('event3', 'Message 3');
      
      const log = logger.getEventLog();
      expect(log.length).toBe(maxEntries);
      expect(log[0].type).toBe('event2');
      expect(log[1].type).toBe('event3');
    });
  });
});

describe('ExecutableGraph - Extended input validation tests (Build API)', () => {
  const computePlugin: INodePlugin = {
    type: 'compute',
    category: 'operational',
    compute: (config: any, inputs: any[]) => {
      // Simple implementation for tests
      if (config && config.code) {
        // In reality there would be safe code evaluation here
        return { result: 'executed' };
      }
      return { result: null };
    }
  };
  
  const customPlugin: INodePlugin = {
    type: 'custom',
    category: 'operational',
    compute: (config: any, inputs: any[]) => {
      // Simple implementation for tests
      return { result: 'custom node executed' };
    }
  };

  test('should allow creating nodes with code in config (Build API does not block)', () => {
    // Build API does not validate code in config at creation time
    // Validation would happen at plugin level if needed
    const graph = createGraph(
      withOptions({
        engine: {
          executionMode: EngineExecutionMode.SERIAL,
          sanitizeInput: true
        }
      }),
      withNodesConfig({
        nodesPlugins: [computePlugin],
        nodes: [
          {
            id: 'dangerousNode',
            type: 'compute',
            config: {
              code: 'return eval("1 + 2");'
            }
          }
        ]
      })
    );
    
    // Build API allows creating the graph
    // The plugin itself would handle unsafe code if needed
    expect(graph).toBeDefined();
    graph.destroy();
  });

  test('should allow updating node configurations', async () => {
    const graph = createGraph(
      withOptions({
        engine: {
          executionMode: EngineExecutionMode.SERIAL,
          sanitizeInput: true
        }
      }),
      withNodesConfig({
        nodesPlugins: [computePlugin],
        nodes: [
          {
            id: 'safeNode',
            type: 'compute',
            config: {
              code: 'return a + b;'
            }
          }
        ]
      })
    );

    await graph.execute();
    await new Promise(resolve => setTimeout(resolve, 100));

    // Start as long-running graph for updates
    const longRunningGraph = graph.run();

    // Update configuration
    longRunningGraph.updateGraph([
      {
        id: 'safeNode',
        type: 'compute',
        config: {
          code: 'return eval("malicious code");'
        }
      }
    ], { autoStart: true });

    await new Promise(resolve => setTimeout(resolve, 100));

    // Build API allows updating the graph
    // The plugin itself would handle unsafe code if needed
    const state = graph.exportState();
    expect(state.nodes['safeNode']).toBeDefined();

    graph.destroy();
  });

  test('should allow creating nodes without input validation', () => {
    const graph = createGraph(
      withOptions({
        engine: {
          executionMode: EngineExecutionMode.SERIAL,
          sanitizeInput: false // Disable input validation
        }
      }),
      withNodesConfig({
        nodesPlugins: [computePlugin],
        nodes: [
          {
            id: 'dangerousNode',
            type: 'compute',
            config: {
              code: 'return eval("1 + 2");'
            }
          }
        ]
      })
    );
    
    // Build API allows creating the graph
    expect(graph).toBeDefined();
    graph.destroy();
  });
});
