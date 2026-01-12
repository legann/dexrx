import { LogLevel } from '../../types/logger';
import { LoggerAdapter } from './logger-adapter';

/**
 * Adapter for console logging with additional capabilities:
 * - storing log history in memory
 * - logging events with metadata
 * - measuring operation execution time
 */
export class ConsoleLoggerAdapter extends LoggerAdapter {
  private logStorage: string[] = [];
  private maxLogSize = 100;

  /**
   * Implementation of log method for console logger
   */
  log(level: LogLevel, message: string, ...args: unknown[]): void {
    if (!this.isLevelEnabled(level)) {
      return;
    }

    const timestamp = new Date().toISOString();
    const prefix = this.getLevelPrefix(level);

    // Format message
    const formattedMessage = `[${timestamp}] ${prefix}: ${message}`;

    // Use appropriate console methods depending on logging level
    /* eslint-disable no-console */
    switch (level) {
      case LogLevel.DEBUG:
        console.debug(formattedMessage, ...args);
        break;
      case LogLevel.INFO:
        console.info(formattedMessage, ...args);
        break;
      case LogLevel.WARN:
        console.warn(formattedMessage, ...args);
        break;
      case LogLevel.ERROR:
        console.error(formattedMessage, ...args);
        break;
      case LogLevel.INPUT_GUARD:
        // INPUT_GUARD can be either Warning or Error
        // Check message content to determine type
        if (message.includes('[InputGuard Warning]')) {
          console.warn(formattedMessage, ...args);
        } else {
          // For [InputGuard Error] and other cases use console.error
          console.error(formattedMessage, ...args);
        }
        break;
      case LogLevel.FATAL:
        console.error(`⚠️ FATAL ${formattedMessage}`, ...args);
        break;
      default:
        console.log(formattedMessage, ...args);
    }
    /* eslint-enable no-console */

    // Save to storage
    this.addToStorage(formattedMessage);
  }

  /**
   * Returns text prefix for logging level
   */
  private getLevelPrefix(level: LogLevel): string {
    switch (level) {
      case LogLevel.DEBUG:
        return 'DEBUG';
      case LogLevel.INFO:
        return 'INFO';
      case LogLevel.WARN:
        return 'WARN';
      case LogLevel.ERROR:
        return 'ERROR';
      case LogLevel.FATAL:
        return 'FATAL';
      case LogLevel.INPUT_GUARD:
        return 'INPUT_GUARD';
      default:
        return 'LOG';
    }
  }

  /**
   * Adds entry to log storage
   */
  private addToStorage(message: string): void {
    this.logStorage.push(message);

    // Remove old entries if limit exceeded
    if (this.logStorage.length > this.maxLogSize) {
      this.logStorage.shift();
    }
  }

  /**
   * Sets maximum size of stored logs
   */
  setMaxLogSize(size: number): void {
    this.maxLogSize = size > 0 ? size : 100;
  }

  /**
   * Clears all logs
   */
  clear(): void {
    this.logStorage = [];
  }

  /**
   * Returns all log entries
   */
  getLogs(): string[] {
    return [...this.logStorage];
  }

  /**
   * Logs event with metadata
   * @param category Event category (e.g., 'graph', 'execution', 'plugin')
   * @param eventName Event name
   * @param metadata Additional metadata
   */
  logEvent(
    category: string,
    eventName: string,
    metadata?: Readonly<Record<string, import('../../types/utils').Serializable>>
  ): void {
    if (!this.isLevelEnabled(LogLevel.INFO)) {
      return;
    }

    let message = `[EVENT][${category}][${eventName}]`;

    if (metadata) {
      try {
        // Add metadata to message
        message += ` ${JSON.stringify(metadata)}`;
      } catch (error) {
        message += ` (metadata serialization error: ${(error as Error).message})`;
      }
    }

    // Output to console and add to storage
    this.log(LogLevel.INFO, message);
  }

  /**
   * Measures operation execution time and logs result
   * @param category Operation category
   * @param operation Operation name
   * @param action Function to execute
   * @returns Function execution result
   */
  measureTime<T>(category: string, operation: string, action: () => T): T {
    const start = performance.now();
    try {
      const result = action();
      const duration = performance.now() - start;
      this.logEvent(category, operation, { duration: `${duration.toFixed(2)}ms` });
      return result;
    } catch (error) {
      const duration = performance.now() - start;
      this.logEvent(category, `${operation}:error`, {
        duration: `${duration.toFixed(2)}ms`,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  /**
   * Extended version of error method with error stack support
   */
  public override error(message: string, ...args: unknown[]): void {
    // Check if there's an error object in arguments
    const errorObj = args.find((arg): arg is Error => arg instanceof Error);
    const otherArgs = args.filter(arg => !(arg instanceof Error));

    // Form full message
    const fullMessage = errorObj ? `${message}: ${errorObj.message}` : message;

    // Log error message
    this.log(LogLevel.ERROR, fullMessage, ...otherArgs);

    // Additionally log stack if it exists
    if (errorObj?.stack) {
      this.log(LogLevel.DEBUG, `Stack: ${errorObj.stack}`);
    }
  }

  /**
   * Extended version of fatal method with error stack support
   */
  public override fatal(message: string, ...args: unknown[]): void {
    // Check if there's an error object in arguments
    const errorObj = args.find((arg): arg is Error => arg instanceof Error);
    const otherArgs = args.filter(arg => !(arg instanceof Error));

    // Form full message
    const fullMessage = errorObj ? `${message}: ${errorObj.message}` : message;

    // Log fatal error message
    this.log(LogLevel.FATAL, fullMessage, ...otherArgs);

    // Additionally log stack if it exists
    if (errorObj?.stack) {
      this.log(LogLevel.DEBUG, `Stack: ${errorObj.stack}`);
    }
  }
}
