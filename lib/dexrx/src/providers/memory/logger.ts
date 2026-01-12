import type { ILoggerProvider } from '../interfaces/logger';
import { ConsoleLoggerAdapter } from '../../utils/logging/console-logger-adapter';
import { LogLevel } from '../../types/logger';

/**
 * Console logger provider implementation
 * Wraps ConsoleLoggerAdapter for Build API usage
 * @category Providers
 */
export class ConsoleLoggerProvider implements ILoggerProvider {
  private readonly adapter: ConsoleLoggerAdapter;

  constructor(options: { level?: LogLevel } = {}) {
    this.adapter = new ConsoleLoggerAdapter();
    if (options.level !== undefined) {
      this.adapter.setLevel(options.level);
    }
  }

  setLevel(level: LogLevel): void {
    this.adapter.setLevel(level);
  }

  getLevel(): LogLevel {
    return this.adapter.getLevel();
  }

  isLevelEnabled(level: LogLevel): boolean {
    return this.adapter.isLevelEnabled(level);
  }

  log(level: LogLevel, message: string, ...args: readonly unknown[]): void {
    this.adapter.log(level, message, ...args);
  }

  debug(message: string, ...args: readonly unknown[]): void {
    this.adapter.debug(message, ...args);
  }

  info(message: string, ...args: readonly unknown[]): void {
    this.adapter.info(message, ...args);
  }

  warn(message: string, ...args: readonly unknown[]): void {
    this.adapter.warn(message, ...args);
  }

  error(message: string, ...args: readonly unknown[]): void {
    this.adapter.error(message, ...args);
  }

  fatal(message: string, ...args: readonly unknown[]): void {
    this.adapter.fatal(message, ...args);
  }

  inputGuardWarn(message: string, silent?: boolean): void {
    this.adapter.inputGuardWarn(message, silent);
  }

  inputGuardError(message: string, error?: Error, silent?: boolean): void {
    this.adapter.inputGuardError(message, error, silent);
  }

  getInputGuardReport(): { warnings: string[]; errors: string[] } {
    return this.adapter.getInputGuardReport();
  }

  clearInputGuardLogs(): void {
    this.adapter.clearInputGuardLogs();
  }

  setInputGuardMaxLogSize(size: number): void {
    this.adapter.setInputGuardMaxLogSize(size);
  }
}
