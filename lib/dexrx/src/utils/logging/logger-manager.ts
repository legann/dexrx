import { ILogger, LogLevel } from '../../types/logger';
import { LoggerFactory, LoggerType } from './logger-factory';

/**
 * Logger manager for implementing inversion of control principle
 * Includes security logging functions for InputGuard
 */
export class LoggerManager {
  private static instance: LoggerManager;
  private logger: ILogger;
  private readonly defaultLoggerName = 'default';

  private constructor() {
    // Initialize default logger through factory
    this.logger = LoggerFactory.getInstance().getLogger(
      this.defaultLoggerName,
      LoggerType.CONSOLE,
      LogLevel.INFO
    );
  }

  /**
   * Get logger manager instance
   */
  public static getInstance(): LoggerManager {
    if (!LoggerManager.instance) {
      LoggerManager.instance = new LoggerManager();
    }
    return LoggerManager.instance;
  }

  /**
   * Set custom logger (IoC implementation)
   */
  public setLogger(logger: ILogger): void {
    this.logger = logger;
  }

  /**
   * Get current logger
   */
  public getLogger(): ILogger {
    return this.logger;
  }

  /**
   * Enables logs with specified level (default INFO)
   */
  public static enableLogs(level: LogLevel = LogLevel.INFO): void {
    LoggerManager.getInstance().logger.setLevel(level);
  }

  /**
   * Disables all logs
   */
  public static disableLogs(): void {
    LoggerManager.getInstance().logger.setLevel(LogLevel.OFF);
  }

  /**
   * Logs debug message
   */
  public static debug(message: string, ...args: unknown[]): void {
    LoggerManager.getInstance().logger.debug(message, ...args);
  }

  /**
   * Logs info message
   */
  public static info(message: string, ...args: unknown[]): void {
    LoggerManager.getInstance().logger.info(message, ...args);
  }

  /**
   * Logs warning
   */
  public static warn(message: string, ...args: unknown[]): void {
    LoggerManager.getInstance().logger.warn(message, ...args);
  }

  /**
   * Logs error
   */
  public static error(message: string, ...args: unknown[]): void {
    LoggerManager.getInstance().logger.error(message, ...args);
  }

  /**
   * Logs fatal error
   */
  public static fatal(message: string, ...args: unknown[]): void {
    LoggerManager.getInstance().logger.fatal(message, ...args);
  }

  /**
   * Logs security message (INPUT_GUARD)
   */
  public static inputGuardInfo(message: string, ...args: unknown[]): void {
    LoggerManager.getInstance().logger.log(LogLevel.INPUT_GUARD, message, ...args);
  }

  /**
   * Logs input data validation warning
   * @param message Warning message
   * @param silent If true, doesn't output to console
   */
  public static inputGuardWarn(message: string, silent = false): void {
    const logger = LoggerManager.getInstance().getLogger();
    if (!silent) {
      logger.log(LogLevel.INPUT_GUARD, `[InputGuard Warning]: ${message}`);
    }
    // Write to warnings storage
    logger.inputGuardWarn(message, true); // silent=true to avoid duplicate output
  }

  /**
   * Logs input data validation error
   * @param message Error message
   * @param error Error object (optional)
   * @param silent If true, doesn't output to console
   */
  public static inputGuardError(message: string, error?: Error, silent = false): void {
    const logger = LoggerManager.getInstance().getLogger();
    if (!silent) {
      logger.log(LogLevel.INPUT_GUARD, `[InputGuard Error]: ${message}`, error);
    }
    // Write to errors storage
    logger.inputGuardError(message, error, true); // silent=true to avoid duplicate output
  }

  /**
   * Gets report on input data validation issues
   */
  public static getInputGuardReport(): { warnings: string[]; errors: string[] } {
    return LoggerManager.getInstance().getLogger().getInputGuardReport();
  }

  /**
   * Clears input data validation logs
   */
  public static clearInputGuardLogs(): void {
    LoggerManager.getInstance().getLogger().clearInputGuardLogs();
  }
}
