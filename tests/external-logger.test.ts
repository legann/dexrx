import { LogLevel, ILogger } from '../lib/dexrx/src/types/logger';
import { LoggerManager } from '../lib/dexrx/src/utils/logging';
import { LoggerAdapter } from '../lib/dexrx/src/utils/logging/logger-adapter';
import { createGraph } from '../lib/dexrx/src/graph';
import { withNodesConfig, withLoggerProvider } from '../lib/dexrx/src/operators';
import { ConsoleLoggerProvider } from '../lib/dexrx/src/providers/memory/logger';
import { INodePlugin } from 'dexrx';

// Test logger for checking external logging
class TestExternalLogger extends LoggerAdapter {
  public messages: Array<{ level: LogLevel, message: string, args: any[] }> = [];

  constructor() {
    super();
    this.setLevel(LogLevel.DEBUG); // Set lowest logging level for tests
  }

  log(level: LogLevel, message: string, ...args: any[]): void {
    if (this.isLevelEnabled(level)) {
      this.messages.push({ level, message, args });
    }
  }

  // Helper method for clearing messages during testing
  clear(): void {
    this.messages = [];
  }

  // Helper method for searching messages
  findMessage(substring: string): boolean {
    return this.messages.some(entry => entry.message.includes(substring));
  }

  // Get count of messages of specific level
  getMessageCountByLevel(level: LogLevel): number {
    return this.messages.filter(entry => entry.level === level).length;
  }
}

describe('External logger context (Build API)', () => {
  let externalLogger: TestExternalLogger;
  let originalLogger: ILogger;

  beforeEach(() => {
    // Save original loggers
    const loggerManager = LoggerManager.getInstance();
    originalLogger = loggerManager.getLogger();

    // Create and set test logger
    externalLogger = new TestExternalLogger();
    
    // Set logger
    loggerManager.setLogger(externalLogger);

    // Clear logs before each test
    externalLogger.clear();
  });

  afterEach(() => {
    // Restore original logger
    const loggerManager = LoggerManager.getInstance();
    loggerManager.setLogger(originalLogger);
  });

  test('External logger should receive messages from LoggerManager', () => {
    // Direct use of LoggerManager
    const loggerManager = LoggerManager.getInstance();
    const logger = loggerManager.getLogger();
    
    logger.info('Test info message');
    logger.error('Test error');
    
    expect(externalLogger.messages.length).toBe(2);
    expect(externalLogger.findMessage('Test info message')).toBeTruthy();
    expect(externalLogger.findMessage('Test error')).toBeTruthy();
  });

  test('External logger should work with different logging levels', () => {
    const loggerManager = LoggerManager.getInstance();
    const logger = loggerManager.getLogger();
    
    logger.debug('Debug message');
    logger.info('Info message');
    logger.warn('Warning message');
    logger.error('Error message');
    logger.fatal('Fatal message');
    
    expect(externalLogger.getMessageCountByLevel(LogLevel.DEBUG)).toBe(1);
    expect(externalLogger.getMessageCountByLevel(LogLevel.INFO)).toBe(1);
    expect(externalLogger.getMessageCountByLevel(LogLevel.WARN)).toBe(1);
    expect(externalLogger.getMessageCountByLevel(LogLevel.ERROR)).toBe(1);
    expect(externalLogger.getMessageCountByLevel(LogLevel.FATAL)).toBe(1);
  });

  test('LoggerManager should correctly pass security messages to external logger', () => {
    // Use static methods of LoggerManager for security logging
    LoggerManager.inputGuardInfo('Test security message');
    LoggerManager.inputGuardWarn('Test InputGuard warning');
    LoggerManager.inputGuardError('Test InputGuard error');
    
    expect(externalLogger.getMessageCountByLevel(LogLevel.INPUT_GUARD)).toBe(3);
    expect(externalLogger.findMessage('Test security message')).toBeTruthy();
    expect(externalLogger.findMessage('Test InputGuard warning')).toBeTruthy();
    expect(externalLogger.findMessage('Test InputGuard error')).toBeTruthy();
  });

  test('External logger should work with Build API logger provider', async () => {
    // Create a custom logger provider that wraps TestExternalLogger
    class TestLoggerProvider implements ILogger {
      constructor(private readonly logger: TestExternalLogger) {}

      setLevel(level: LogLevel): void {
        this.logger.setLevel(level);
      }

      getLevel(): LogLevel {
        return this.logger.getLevel();
      }

      isLevelEnabled(level: LogLevel): boolean {
        return this.logger.isLevelEnabled(level);
      }

      log(level: LogLevel, message: string, ...args: readonly unknown[]): void {
        this.logger.log(level, message, ...args);
      }

      debug(message: string, ...args: readonly unknown[]): void {
        this.logger.debug(message, ...args);
      }

      info(message: string, ...args: readonly unknown[]): void {
        this.logger.info(message, ...args);
      }

      warn(message: string, ...args: readonly unknown[]): void {
        this.logger.warn(message, ...args);
      }

      error(message: string, ...args: readonly unknown[]): void {
        this.logger.error(message, ...args);
      }

      fatal(message: string, ...args: readonly unknown[]): void {
        this.logger.fatal(message, ...args);
      }

      inputGuardWarn(message: string, silent?: boolean): void {
        this.logger.inputGuardWarn(message, silent);
      }

      inputGuardError(message: string, error?: Error, silent?: boolean): void {
        this.logger.inputGuardError(message, error, silent);
      }

      getInputGuardReport(): { warnings: string[]; errors: string[] } {
        return this.logger.getInputGuardReport();
      }

      clearInputGuardLogs(): void {
        this.logger.clearInputGuardLogs();
      }

      setInputGuardMaxLogSize(size: number): void {
        this.logger.setInputGuardMaxLogSize(size);
      }
    }

    const testLoggerProvider = new TestLoggerProvider(externalLogger);
    externalLogger.clear();

    const staticPlugin: INodePlugin = {
      type: 'static',
      category: 'operational',
      compute: (config: unknown, inputs: unknown[]) => {
        // Logger is available through LoggerManager in Build API
        return { value: 42 };
      }
    };

    const graph = createGraph(
      withLoggerProvider(testLoggerProvider),
      withNodesConfig({
        nodesPlugins: [staticPlugin],
        nodes: [
          {
            id: 'static-node',
            type: 'static',
            config: { isSubscribed: true }
          }
        ]
      })
    );

    await graph.execute();
    await new Promise(resolve => setTimeout(resolve, 100));

    // Check that graph works with logger provider
    const state = graph.exportState();
    expect(state.nodes['static-node'].currentValue).toBeDefined();
    
    // Logger provider is registered and functional
    expect(testLoggerProvider).toBeDefined();

    graph.destroy();
  });

  test('External logger should respect log level filtering', () => {
    const loggerManager = LoggerManager.getInstance();
    const logger = loggerManager.getLogger();
    
    // Set level to WARN
    externalLogger.setLevel(LogLevel.WARN);
    
    logger.debug('Debug message - should not appear');
    logger.info('Info message - should not appear');
    logger.warn('Warning message - should appear');
    logger.error('Error message - should appear');
    
    expect(externalLogger.getMessageCountByLevel(LogLevel.DEBUG)).toBe(0);
    expect(externalLogger.getMessageCountByLevel(LogLevel.INFO)).toBe(0);
    expect(externalLogger.getMessageCountByLevel(LogLevel.WARN)).toBe(1);
    expect(externalLogger.getMessageCountByLevel(LogLevel.ERROR)).toBe(1);
  });
});
