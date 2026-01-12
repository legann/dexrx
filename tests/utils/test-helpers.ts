import { filter } from 'rxjs';
import { INIT_NODE_EXEC, SKIP_NODE_EXEC } from '../../lib/dexrx/src/types/engine-flags';

/**
 * RxJS operator for filtering INIT_NODE_EXEC and SKIP_NODE_EXEC symbols
 * Used in tests to get only real values
 *
 * Important: Tests should handle INIT_NODE_EXEC as part of core logic,
 * but for checking results need to filter service symbols
 */
export function filterInitExec<T>() {
  return filter<T>((value: any) => {
    return value !== INIT_NODE_EXEC && value !== SKIP_NODE_EXEC && value !== null && value !== undefined;
  });
}

/**
 * Checks if value is INIT_NODE_EXEC symbol
 */
export function isInitExec(value: any): boolean {
  return value === INIT_NODE_EXEC;
}

/**
 * Checks if value is SKIP_NODE_EXEC symbol
 */
export function isSkipExec(value: any): boolean {
  return value === SKIP_NODE_EXEC;
}

/**
 * Checks if value is valid (not INIT_NODE_EXEC, not SKIP_NODE_EXEC, not null, not undefined)
 */
export function isValidValue(value: any): boolean {
  return value !== INIT_NODE_EXEC && value !== SKIP_NODE_EXEC && value !== null && value !== undefined;
}

/**
 * Helper function for waiting for real value from Observable
 * Skips INIT_NODE_EXEC and SKIP_NODE_EXEC, returns first valid value
 */
export function waitForValidValue<T>(observable: any, timeout: number = 5000): Promise<T> {
  return new Promise((resolve, reject) => {
    const subscription = observable?.pipe(filterInitExec<T>()).subscribe({
      next: (value: T) => {
        subscription?.unsubscribe();
        resolve(value);
      },
      error: (err: any) => {
        subscription?.unsubscribe();
        reject(err);
      },
    });

    setTimeout(() => {
      subscription?.unsubscribe();
      reject(new Error(`Timeout waiting for valid value after ${timeout}ms`));
    }, timeout);
  });
}
