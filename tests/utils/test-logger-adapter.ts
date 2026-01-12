import { LogLevel } from '../../lib/dexrx/src/types/logger';
import { LoggerAdapter } from '../../lib/dexrx/src/utils/logging/logger-adapter';

/**
 * Test logger adapter
 * Used exclusively for testing
 */
export class TestLoggerAdapter extends LoggerAdapter {
  // Flag for test mode (local only in tests)
  private testMode = false;

  /**
   * Sets test mode
   * This method is only available in test adapter and is not part of ILogger interface
   */
  setTestMode(enabled: boolean): void {
    this.testMode = enabled;
  }

  /**
   * Returns test mode status
   */
  isTestMode(): boolean {
    return this.testMode;
  }

  /**
   * Override inputGuardError method so that in test mode
   * cycle messages are not output to console
   */
  inputGuardError(message: string, error?: Error, silent = false): void {
    // In test mode cycle messages are always suppressed
    const isCycleError = message.includes('Cycle detected');
    const shouldBeSilent = silent || (this.testMode && isCycleError);

    // Call base implementation with new silent value
    super.inputGuardError(message, error, shouldBeSilent);
  }

  /**
   * Implementation of log method
   */
  log(level: LogLevel, message: string, ...args: any[]): void {
    // In test mode don't output logs, except security-related ones
    if (this.testMode && level !== LogLevel.INPUT_GUARD) {
      return;
    }

    // Format timestamp
    const timestamp = new Date().toISOString();

    // Output log to console
    if (level >= this.level) {
      const prefix = `[${timestamp}] ${LogLevel[level]}: `;
      console.log(prefix + message, ...args);
    }
  }
}
