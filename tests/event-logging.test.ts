import { LogLevel } from '../lib/dexrx/src/types/logger';
import { ConsoleLoggerAdapter } from '../lib/dexrx/src/utils/logging/console-logger-adapter';

// Create mocks for testing
class MockPlugin {
  id = '';
  
  async execute(inputs: any): Promise<any> {
    return inputs;
  }
}

class MockGraph {
  private nodes: MockPlugin[] = [];
  
  addNode(plugin: MockPlugin): void {
    this.nodes.push(plugin);
  }
  
  getNodes(): MockPlugin[] {
    return this.nodes;
  }
}

class MockEngine {
  constructor(private graph: MockGraph) {}
  
  async execute(inputs: any): Promise<any> {
    const results: any = {};
    for (const node of this.graph.getNodes()) {
      results[node.id] = await node.execute(inputs);
    }
    return results;
  }
}

describe('Event Logging - Event logging', () => {
  let logger: ConsoleLoggerAdapter;
  
  beforeEach(() => {
    logger = new ConsoleLoggerAdapter();
    logger.setLevel(LogLevel.INFO); // Set lowest logging level
    logger.clear(); // Clear logs before each test
  });
  
  it('should log basic events', () => {
    // Log event
    logger.logEvent('test', 'initialization', { status: 'success' });
    
    // Check that log contains event
    const logs = logger.getLogs();
    expect(logs.length).toBe(1);
    expect(logs[0]).toContain('[EVENT][test][initialization]');
    expect(logs[0]).toContain('"status":"success"');
  });
  
  it('should measure execution time', () => {
    // Use time measurement function
    const result = logger.measureTime('test', 'calculation', () => {
      // Simulate long operation
      let sum = 0;
      for (let i = 0; i < 1000000; i++) {
        sum += i;
      }
      return sum;
    });
    
    // Check result
    expect(result).toBeGreaterThan(0);
    
    // Check that log contains execution time information
    const logs = logger.getLogs();
    expect(logs.length).toBe(1);
    expect(logs[0]).toContain('[EVENT][test][calculation]');
    expect(logs[0]).toContain('duration');
  });
  
  it('should log events during graph execution', async () => {
    // Create plugin that will log events
    class LoggingPlugin extends MockPlugin {
      constructor(private logger: ConsoleLoggerAdapter) {
        super();
      }
      
      async execute(inputs: any): Promise<any> {
        this.logger.logEvent('plugin', 'execution-start', { 
          pluginId: this.id,
          inputs
        });
        
        // Simulate some work
        const result = { output: inputs.value * 2 };
        
        this.logger.logEvent('plugin', 'execution-end', { 
          pluginId: this.id,
          result
        });
        
        return result;
      }
    }
    
    // Create graph and engine
    const graph = new MockGraph();
    const plugin = new LoggingPlugin(logger);
    plugin.id = 'test-plugin';
    graph.addNode(plugin);
    
    const engine = new MockEngine(graph);
    
    // Start graph execution
    await engine.execute({ value: 10 });
    
    // Check logs
    const logs = logger.getLogs();
    expect(logs.length).toBeGreaterThanOrEqual(2);
    expect(logs.some(log => log.includes('[EVENT][plugin][execution-start]'))).toBe(true);
    expect(logs.some(log => log.includes('[EVENT][plugin][execution-end]'))).toBe(true);
  });
  
  it('should handle errors in logged events', () => {
    // Create object with circular reference that cannot be serialized
    const cyclicObject: any = { name: 'test' };
    cyclicObject.self = cyclicObject;
    
    // Log event with circular object
    logger.logEvent('test', 'cyclic-error', cyclicObject);
    
    // Check that error was handled
    const logs = logger.getLogs();
    expect(logs.length).toBe(1);
    expect(logs[0]).toContain('[EVENT][test][cyclic-error]');
    expect(logs[0]).toContain('metadata serialization error');
  });
  
  it('should log errors correctly', () => {
    try {
      // Try to execute function that throws error
      logger.measureTime('test', 'error-operation', () => {
        throw new Error('Test error');
      });
    } catch (error) {
      // Check that error was logged
      const logs = logger.getLogs();
      expect(logs.length).toBe(1);
      expect(logs[0]).toContain('[EVENT][test][error-operation:error]');
      expect(logs[0]).toContain('Test error');
    }
  });
});

// Mock console methods
let consoleLogSpy: jest.SpyInstance;
let consoleInfoSpy: jest.SpyInstance;

beforeEach(() => {
  // Create spies for console methods
  consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
  consoleInfoSpy = jest.spyOn(console, 'info').mockImplementation();
});

afterEach(() => {
  // Restore original methods
  consoleLogSpy.mockRestore();
  consoleInfoSpy.mockRestore();
});

test('should log events with metadata', () => {
  // Create and configure logger
  const logger = new ConsoleLoggerAdapter();
  logger.setLevel(LogLevel.INFO);

  // Call logEvent method with metadata
  const metadata = { userId: 123, action: 'login' };
  logger.logEvent('user', 'authentication', metadata);

  // Check that event was logged
  expect(consoleInfoSpy).toHaveBeenCalled();
  const logMessage = consoleInfoSpy.mock.calls[0][0];
  
  // Check that message contains all necessary parts
  expect(logMessage).toContain('[EVENT][user][authentication]');
  expect(logMessage).toContain('userId');
  expect(logMessage).toContain('123');
  expect(logMessage).toContain('login');
});

test('should correctly serialize complex metadata objects', () => {
  const logger = new ConsoleLoggerAdapter();
  logger.setLevel(LogLevel.INFO);

  // Create complex metadata object with circular references
  const nestedObj = { nestedValue: 'test' };
  const metadata: any = { 
    id: 1, 
    values: [1, 2, 3], 
    nested: nestedObj,
    date: new Date(2023, 0, 1)
  };
  
  // Add circular reference
  metadata.self = metadata;

  // Mock console.error to check serialization errors
  const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
  
  try {
    // Call logEvent method with problematic metadata
    logger.logEvent('test', 'serialize', metadata);
    
    // Check that event was logged
    expect(consoleInfoSpy).toHaveBeenCalled();
    const logMessage = consoleInfoSpy.mock.calls[0][0];
    
    // Check that message contains serialization error information
    expect(logMessage).toContain('[EVENT][test][serialize]');
    expect(logMessage).toContain('metadata serialization error');
  } finally {
    consoleErrorSpy.mockRestore();
  }
});

test('should measure function execution time', () => {
  const logger = new ConsoleLoggerAdapter();
  logger.setLevel(LogLevel.INFO);
  
  // Mock performance.now for stable tests
  const originalPerformanceNow = performance.now;
  performance.now = jest.fn()
    .mockReturnValueOnce(1000) // First call - start
    .mockReturnValueOnce(1200); // Second call - end (200ms difference)
  
  try {
    // Measure function time
    const result = logger.measureTime('performance', 'test-operation', () => 'test-result');
    
    // Check function result
    expect(result).toBe('test-result');
    
    // Check that message with correct metadata was logged
    expect(consoleInfoSpy).toHaveBeenCalled();
    const logMessage = consoleInfoSpy.mock.calls[0][0];
    
    expect(logMessage).toContain('[EVENT][performance][test-operation]');
    expect(logMessage).toContain('200.00ms');
  } finally {
    // Restore original method
    performance.now = originalPerformanceNow;
  }
});

test('should correctly handle errors during time measurement', () => {
  const logger = new ConsoleLoggerAdapter();
  logger.setLevel(LogLevel.INFO);
  
  // Mock performance.now for stable tests
  const originalPerformanceNow = performance.now;
  performance.now = jest.fn()
    .mockReturnValueOnce(1000) // First call - start
    .mockReturnValueOnce(1500); // Second call - end (500ms difference)
  
  try {
    // Try to measure time of function that throws error
    const testError = new Error('Test function error');
    expect(() => {
      logger.measureTime('performance', 'error-operation', () => {
        throw testError;
      });
    }).toThrow(testError);
    
    // Check that error message was logged with correct metadata
    expect(consoleInfoSpy).toHaveBeenCalled();
    const logMessage = consoleInfoSpy.mock.calls[0][0];
    
    expect(logMessage).toContain('[EVENT][performance][error-operation:error]');
    expect(logMessage).toContain('500.00ms');
    expect(logMessage).toContain('Test function error');
  } finally {
    // Restore original method
    performance.now = originalPerformanceNow;
  }
});

// Demonstration of using external classes for event logging
class EventLogger {
  constructor(private logger: ConsoleLoggerAdapter) {}
  
  logUserEvent(userId: string, action: string, details?: any): void {
    this.logger.logEvent('user', action, { userId, ...details });
  }
  
  measureOperation<T>(operation: string, action: () => T): T {
    return this.logger.measureTime('operation', operation, action);
  }
}

test('Integration with custom classes for logging', () => {
  // Create spy for logEvent method
  const logger = new ConsoleLoggerAdapter();
  const logEventSpy = jest.spyOn(logger, 'logEvent');
  
  // Create custom event logger
  const eventLogger = new EventLogger(logger);
  
  // Log user event
  eventLogger.logUserEvent('user123', 'login', { device: 'mobile', ipAddress: '192.168.1.1' });
  
  // Check that logEvent was called with correct parameters
  expect(logEventSpy).toHaveBeenCalled();
  const callArgs = logEventSpy.mock.calls[0];
  expect(callArgs[0]).toBe('user');
  expect(callArgs[1]).toBe('login');
  expect(callArgs[2]).toBeDefined();
  const metadata = callArgs[2] as { userId: string; device: string; ipAddress: string };
  expect(metadata.userId).toBe('user123');
  expect(metadata.device).toBe('mobile');
  expect(metadata.ipAddress).toBe('192.168.1.1');
  
  // Restore original method
  logEventSpy.mockRestore();
}); 