import { ILogger, LogLevel } from '../../types/logger';
import { ConsoleLoggerAdapter } from './console-logger-adapter';

/**
 * Logger type
 */
export enum LoggerType {
  CONSOLE = 'console',
  // Can add other logger types in future: FILE, NETWORK, etc.
}

/**
 * Factory for creating loggers
 */
export class LoggerFactory {
  private static instance: LoggerFactory;
  private readonly loggers: Map<string, ILogger> = new Map();

  private constructor() {
    // Private constructor for singleton
  }

  /**
   * Get logger factory instance
   */
  public static getInstance(): LoggerFactory {
    if (!LoggerFactory.instance) {
      LoggerFactory.instance = new LoggerFactory();
    }
    return LoggerFactory.instance;
  }

  /**
   * Create or get logger by name and type
   *
   * @param name Logger name
   * @param type Logger type
   * @param level Initial logging level
   * @returns Logger instance
   */
  public getLogger(
    name: string,
    type: LoggerType = LoggerType.CONSOLE,
    level: LogLevel = LogLevel.INFO
  ): ILogger {
    const loggerKey = `${name}:${type}`;

    const existingLogger = this.loggers.get(loggerKey);
    if (existingLogger) {
      return existingLogger;
    }

    let logger: ILogger;

    switch (type) {
      case LoggerType.CONSOLE:
      default:
        // Create ConsoleLoggerAdapter instance
        logger = new ConsoleLoggerAdapter();
        // Set logging level after creation
        logger.setLevel(level);
    }

    this.loggers.set(loggerKey, logger);
    return logger;
  }

  /**
   * Reset all loggers
   */
  public resetLoggers(): void {
    this.loggers.clear();
  }
}
