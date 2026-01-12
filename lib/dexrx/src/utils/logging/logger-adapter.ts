import { ILogger, LogLevel } from '../../types/logger';

/**
 * Base class for external logger adapter
 */
export abstract class LoggerAdapter implements ILogger {
  protected level: LogLevel = LogLevel.INFO;
  private inputGuardWarnings: string[] = [];
  private inputGuardErrors: string[] = [];
  private inputGuardMaxLogSize = 100;

  /**
   * Sets logging level
   */
  setLevel(level: LogLevel): void {
    this.level = level;
  }

  /**
   * Gets current logging level
   */
  getLevel(): LogLevel {
    return this.level;
  }

  /**
   * Checks if specified logging level is enabled
   */
  isLevelEnabled(level: LogLevel): boolean {
    return level >= this.level;
  }

  /**
   * Logs message with specified level
   * This method must be implemented in concrete adapters
   */
  abstract log(level: LogLevel, message: string, ...args: unknown[]): void;

  /**
   * Logs debug message
   */
  debug(message: string, ...args: unknown[]): void {
    this.log(LogLevel.DEBUG, message, ...args);
  }

  /**
   * Logs info message
   */
  info(message: string, ...args: unknown[]): void {
    this.log(LogLevel.INFO, message, ...args);
  }

  /**
   * Logs warning
   */
  warn(message: string, ...args: unknown[]): void {
    this.log(LogLevel.WARN, message, ...args);
  }

  /**
   * Logs error
   */
  error(message: string, ...args: unknown[]): void {
    this.log(LogLevel.ERROR, message, ...args);
  }

  /**
   * Logs fatal error
   */
  fatal(message: string, ...args: unknown[]): void {
    this.log(LogLevel.FATAL, message, ...args);
  }

  /**
   * Logs input data validation warning
   * @param message Warning message
   * @param silent If true, doesn't output to console
   */
  inputGuardWarn(message: string, silent = false): void {
    // Output message to console if not silent
    if (!silent) {
      this.log(LogLevel.INPUT_GUARD, `[InputGuard Warning]: ${message}`);
    }

    // Always save to local array for reports
    this.inputGuardWarnings.push(`${new Date().toISOString()}: ${message}`);

    // Limit array size
    if (this.inputGuardWarnings.length > this.inputGuardMaxLogSize) {
      this.inputGuardWarnings.shift();
    }
  }

  /**
   * Logs input data validation error
   * @param message Error message
   * @param error Error object (optional)
   * @param silent If true, doesn't output to console
   */
  inputGuardError(message: string, error?: Error, silent = false): void {
    // Remove test mode check
    if (!silent) {
      this.log(LogLevel.INPUT_GUARD, `[InputGuard Error]: ${message}`, error);
    }

    // Always save to local array for reports
    this.inputGuardErrors.push(
      `${new Date().toISOString()}: ${message} ${error ? `(${error.message})` : ''}`
    );

    // Limit array size
    if (this.inputGuardErrors.length > this.inputGuardMaxLogSize) {
      this.inputGuardErrors.shift();
    }
  }

  /**
   * Returns report on input data validation issues
   * @returns Object with arrays of warnings and errors
   */
  getInputGuardReport(): { warnings: string[]; errors: string[] } {
    return {
      warnings: [...this.inputGuardWarnings],
      errors: [...this.inputGuardErrors],
    };
  }

  /**
   * Clears all input data validation logs
   */
  clearInputGuardLogs(): void {
    this.inputGuardWarnings = [];
    this.inputGuardErrors = [];
  }

  /**
   * Sets maximum size of stored input data validation logs
   * @param size Maximum number of entries
   */
  setInputGuardMaxLogSize(size: number): void {
    this.inputGuardMaxLogSize = size > 0 ? size : 100;
  }
}
