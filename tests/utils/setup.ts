/**
 * Configuration for test environment setup
 */
import { LoggerManager } from '../../lib/dexrx/src/utils/logging';
import { TestLoggerAdapter } from './test-logger-adapter';

// Create test logger
const testLogger = new TestLoggerAdapter();
testLogger.setTestMode(true);

// Register test logger in manager
LoggerManager.getInstance().setLogger(testLogger);

// Object for convenient access to InputGuard logger functions
const InputGuardLogger = {
  setTestMode: (isTestMode: boolean) => (testLogger as TestLoggerAdapter).setTestMode(isTestMode),
  clear: () => LoggerManager.clearInputGuardLogs(),
  warn: (message: string, silent?: boolean) => LoggerManager.inputGuardWarn(message, silent),
  error: (message: string, error?: Error, silent?: boolean) =>
    LoggerManager.inputGuardError(message, error, silent),
  getReport: () => LoggerManager.getInputGuardReport(),
};

// Always disable logs in tests
LoggerManager.disableLogs();

// Suppress error output to console during tests
// Original functions
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;
const originalConsoleLog = console.log;
const originalConsoleInfo = console.info;
const originalConsoleDebug = console.debug;

// Redirect console methods
console.log = () => {};
console.info = () => {};
console.debug = () => {};

// Intercept console.error and console.warn calls
// related to security messages and test errors
console.error = function (...args) {
  // Skip messages related to test errors and security issues
  if (
    typeof args[0] === 'string' &&
    (args[0].includes('[InputGuard Error]') ||
      args[0].includes('[Security Error]') ||
      args[0].includes('Test computation error'))
  ) {
    return; // Skip output
  }
  // Call original method for other messages
  originalConsoleError.apply(console, args);
};

console.warn = function (...args) {
  // Skip security messages
  if (
    typeof args[0] === 'string' &&
    (args[0].includes('[InputGuard Warning]') || args[0].includes('[Security Warning]'))
  ) {
    return; // Skip output
  }
  // Call original method for other messages
  originalConsoleWarn.apply(console, args);
};

// After all tests restore original behavior
afterAll(() => {
  console.error = originalConsoleError;
  console.warn = originalConsoleWarn;
  console.log = originalConsoleLog;
  console.info = originalConsoleInfo;
  console.debug = originalConsoleDebug;
});

// Clear logs before each test
beforeEach(() => {
  InputGuardLogger.clear();
});

/**
 * Settings executed before each Jest test
 */

// Set environment variable to identify test environment
process.env.NODE_ENV = 'test';

// Increase test timeout
jest.setTimeout(30000);

// Global cleanup after all tests
afterAll(async () => {
  // Force resource cleanup
  if (typeof global.gc === 'function') {
    global.gc();
  }

  // Give time for workers to close
  await new Promise(resolve => setTimeout(resolve, 500));
});
