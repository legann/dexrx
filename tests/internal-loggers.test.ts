import { LogLevel } from '../lib/dexrx/src/types/logger';
import { ConsoleLoggerAdapter } from '../lib/dexrx/src/utils/logging/console-logger-adapter';
import { LoggerManager } from '../lib/dexrx/src/utils/logging';

describe('ConsoleLoggerAdapter - Internal implementation', () => {
  let consoleLogger: ConsoleLoggerAdapter;
  
  // Intercept console.log and other console methods
  let consoleLogSpy: jest.SpyInstance;
  let consoleInfoSpy: jest.SpyInstance;
  let consoleWarnSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;
  let consoleDebugSpy: jest.SpyInstance;
  
  beforeEach(() => {
    consoleLogger = new ConsoleLoggerAdapter();
    
    // Create spies for console methods
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
    consoleInfoSpy = jest.spyOn(console, 'info').mockImplementation();
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
    consoleDebugSpy = jest.spyOn(console, 'debug').mockImplementation();
  });
  
  afterEach(() => {
    // Restore original console methods
    consoleLogSpy.mockRestore();
    consoleInfoSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    consoleDebugSpy.mockRestore();
  });
  
  test('should correctly set and get logging level', () => {
    expect(consoleLogger.getLevel()).toBe(LogLevel.INFO);
    
    consoleLogger.setLevel(LogLevel.DEBUG);
    expect(consoleLogger.getLevel()).toBe(LogLevel.DEBUG);
    
    consoleLogger.setLevel(LogLevel.ERROR);
    expect(consoleLogger.getLevel()).toBe(LogLevel.ERROR);
  });
  
  test('should check if specified logging level is enabled', () => {
    consoleLogger.setLevel(LogLevel.WARN);
    
    expect(consoleLogger.isLevelEnabled(LogLevel.DEBUG)).toBe(false);
    expect(consoleLogger.isLevelEnabled(LogLevel.INFO)).toBe(false);
    
    // WARN level and above should be enabled
    expect(consoleLogger.isLevelEnabled(LogLevel.WARN)).toBe(true);
    expect(consoleLogger.isLevelEnabled(LogLevel.ERROR)).toBe(true);
    expect(consoleLogger.isLevelEnabled(LogLevel.FATAL)).toBe(true);
  });
  
  test('should log messages with corresponding console methods', () => {
    consoleLogger.setLevel(LogLevel.DEBUG); // Set DEBUG level to log all messages
    
    consoleLogger.debug('Debug message');
    expect(consoleDebugSpy).toHaveBeenCalled();
    
    consoleLogger.info('Info message');
    expect(consoleInfoSpy).toHaveBeenCalled();
    
    consoleLogger.warn('Warning message');
    expect(consoleWarnSpy).toHaveBeenCalled();
    
    consoleLogger.error('Error message');
    expect(consoleErrorSpy).toHaveBeenCalled();
    
    consoleLogger.fatal('Fatal message');
    expect(consoleErrorSpy).toHaveBeenCalled(); // FATAL uses console.error
  });
  
  test('should not log messages below set level', () => {
    consoleLogger.setLevel(LogLevel.ERROR);
    
    consoleLogger.debug('Debug message');
    consoleLogger.info('Info message');
    consoleLogger.warn('Warning message');
    
    // These messages should not be sent to console
    expect(consoleDebugSpy).not.toHaveBeenCalled();
    expect(consoleInfoSpy).not.toHaveBeenCalled();
    expect(consoleWarnSpy).not.toHaveBeenCalled();
    
    // Only ERROR and FATAL messages should be sent
    consoleLogger.error('Error message');
    consoleLogger.fatal('Fatal message');
    
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  test('should format messages with timestamp and level', () => {
    const originalDateNow = Date.prototype.toISOString;
    const mockTimestamp = '2023-01-01T12:00:00.000Z';
    
    // Mock toISOString for stable timestamp
    Date.prototype.toISOString = jest.fn(() => mockTimestamp);
    
    consoleLogger.setLevel(LogLevel.INFO);
    consoleLogger.info('Test message');
    
    // Check that call contains message with timestamp
    expect(consoleInfoSpy).toHaveBeenCalledWith(
      `[${mockTimestamp}] INFO: Test message`
    );
    
    // Restore original method
    Date.prototype.toISOString = originalDateNow;
  });
  
  test('should pass additional arguments to logs', () => {
    consoleLogger.setLevel(LogLevel.INFO);
    
    const additionalArgs = { id: 1, name: 'test' };
    consoleLogger.info('Object test', additionalArgs);
    
    expect(consoleInfoSpy).toHaveBeenCalled();
    const callArgs = consoleInfoSpy.mock.calls[0];
    expect(typeof callArgs[0]).toBe('string');
    expect(callArgs[1]).toEqual(additionalArgs);
  });
  
  test('should store log history', () => {
    consoleLogger.clear(); // Clear history
    
    consoleLogger.setLevel(LogLevel.INFO);
    consoleLogger.info('Test message 1');
    consoleLogger.info('Test message 2');
    
    const logs = consoleLogger.getLogs();
    expect(logs.length).toBe(2);
    expect(logs[0]).toContain('Test message 1');
    expect(logs[1]).toContain('Test message 2');
  });
  
  test('should limit size of stored logs', () => {
    consoleLogger.clear();
    consoleLogger.setMaxLogSize(2);
    
    consoleLogger.info('Message 1');
    consoleLogger.info('Message 2');
    consoleLogger.info('Message 3');
    
    const logs = consoleLogger.getLogs();
    
    // Should be only 2 last messages
    expect(logs.length).toBe(2);
    expect(logs[0]).toContain('Message 2');
    expect(logs[1]).toContain('Message 3');
  });
  
  test('should log events with metadata', () => {
    consoleLogger.clear();
    
    // Mock toISOString for stable tests
    const originalDateNow = Date.prototype.toISOString;
    const mockTimestamp = '2023-01-01T12:00:00.000Z';
    Date.prototype.toISOString = jest.fn(() => mockTimestamp);
    
    const metadata = { userId: 123, action: 'login' };
    consoleLogger.logEvent('user', 'authentication', metadata);
    
    const logs = consoleLogger.getLogs();
    expect(logs.length).toBe(1);
    expect(logs[0]).toContain('[EVENT][user][authentication]');
    expect(logs[0]).toContain('userId');
    expect(logs[0]).toContain('login');
    
    // Restore original method
    Date.prototype.toISOString = originalDateNow;
  });
  
  test('should measure function execution time', () => {
    // Mock performance.now
    const originalPerformanceNow = performance.now;
    performance.now = jest.fn()
      .mockReturnValueOnce(1000) // First call - start
      .mockReturnValueOnce(1500); // Second call - end (500ms difference)
    
    const result = consoleLogger.measureTime('test', 'operation', () => 'result');
    
    // Check that function returned correct result
    expect(result).toBe('result');
    
    // Check that logging occurred with correct metadata
    const logs = consoleLogger.getLogs();
    expect(logs.length).toBe(1);
    expect(logs[0]).toContain('[EVENT][test][operation]');
    expect(logs[0]).toContain('500.00ms');
    
    // Restore original method
    performance.now = originalPerformanceNow;
  });
  
  test('should work with LoggerManager via IoC', () => {
    // Create custom logger and configure it
    const customLogger = new ConsoleLoggerAdapter();
    customLogger.setLevel(LogLevel.DEBUG);
    
    // Set it in LoggerManager
    LoggerManager.getInstance().setLogger(customLogger);
    
    // Now all logs through LoggerManager should go through our logger
    LoggerManager.info('Test message through manager');
    
    // Check that message got into our logger's history
    const logs = customLogger.getLogs();
    expect(logs.length).toBe(1);
    expect(logs[0]).toContain('Test message through manager');
    
    // Restore default logger for other tests
    LoggerManager.getInstance().setLogger(new ConsoleLoggerAdapter());
  });
}); 