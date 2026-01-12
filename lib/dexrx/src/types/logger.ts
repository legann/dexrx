/**
 * Logging level enumeration
 */
export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  FATAL = 4,
  INPUT_GUARD = 5, // Level for security events and input data validation
  OFF = 100, // Disable all logs
}

/**
 * Logger interface
 */
export interface ILogger {
  /**
   * Sets logging level
   * @param level Logging level to set
   */
  setLevel(level: LogLevel): void;

  /**
   * Gets current logging level
   * @returns Current logging level
   */
  getLevel(): LogLevel;

  /**
   * Checks if specified logging level is enabled
   * @param level Logging level to check
   * @returns True if level is enabled
   */
  isLevelEnabled(level: LogLevel): boolean;

  /**
   * Logs message with specified level
   * @param level Logging level
   * @param message Message to log
   * @param args Additional arguments to log
   */
  log(level: LogLevel, message: string, ...args: readonly unknown[]): void;

  /**
   * Logs debug message
   * @param message Message to log
   * @param args Additional arguments to log
   */
  debug(message: string, ...args: readonly unknown[]): void;

  /**
   * Logs info message
   * @param message Message to log
   * @param args Additional arguments to log
   */
  info(message: string, ...args: readonly unknown[]): void;

  /**
   * Logs warning
   * @param message Message to log
   * @param args Additional arguments to log
   */
  warn(message: string, ...args: readonly unknown[]): void;

  /**
   * Logs error
   * @param message Message to log
   * @param args Additional arguments to log
   */
  error(message: string, ...args: readonly unknown[]): void;

  /**
   * Logs fatal error
   * @param message Message to log
   * @param args Additional arguments to log
   */
  fatal(message: string, ...args: readonly unknown[]): void;

  /**
   * Logs input data validation warning
   * @param message Warning message
   * @param silent If true, message is not output to console but saved to history
   */
  inputGuardWarn(message: string, silent?: boolean): void;

  /**
   * Logs input data validation error
   * @param message Error message
   * @param error Error object (optional)
   * @param silent If true, message is not output to console but saved to history
   */
  inputGuardError(message: string, error?: Error, silent?: boolean): void;

  /**
   * Returns report on input data validation issues
   * @returns Report object with warnings and errors arrays
   */
  getInputGuardReport(): { warnings: string[]; errors: string[] };

  /**
   * Clears input data validation logs
   */
  clearInputGuardLogs(): void;

  /**
   * Sets maximum size of stored input data validation logs
   * @param size Maximum log size
   */
  setInputGuardMaxLogSize(size: number): void;
}
