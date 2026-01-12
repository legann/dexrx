/**
 * Utilities for working with cancelable tasks in tests
 * These functions are used only for testing and are not part of the main library
 */

// Import interface from main library
import { ICancelableComputation } from '../../lib/dexrx/src/types/cancelable-computation';

/**
 * Creates cancelable task based on AbortController
 * Simplifies creation of cancelable operations for tests
 *
 * @param executor Function that takes AbortSignal and returns Promise
 * @returns Cancelable task
 *
 * @example
 * createCancelableTask(signal => {
 *   return new Promise((resolve, reject) => {
 *     const timer = setTimeout(() => resolve('done'), 1000);
 *     signal.addEventListener('abort', () => {
 *       clearTimeout(timer);
 *       reject(new Error('Operation cancelled'));
 *     });
 *   });
 * });
 */
export function createCancelableTask<T>(
  executor: (signal: AbortSignal) => Promise<T>
): ICancelableComputation<T> {
  const controller = new AbortController();
  const signal = controller.signal;

  return {
    promise: executor(signal),
    cancel: () => controller.abort(),
  };
}

/**
 * Creates task that is automatically cancelled after specified time
 *
 * @param task Original task
 * @param timeoutMs Time in milliseconds after which task will be cancelled
 * @returns New cancelable task with timeout
 */
export function withTimeout<T>(
  task: ICancelableComputation<T>,
  timeoutMs: number
): ICancelableComputation<T> {
  const controller = new AbortController();
  const signal = controller.signal;

  // Create timer for cancellation
  const timer = setTimeout(() => {
    task.cancel();
    controller.abort();
  }, timeoutMs);

  // Create new Promise that will cancel either on timeout or on original task cancellation
  const promise = Promise.race([
    task.promise.then(
      value => {
        clearTimeout(timer);
        return value;
      },
      error => {
        clearTimeout(timer);
        throw error;
      }
    ),
    new Promise<never>((_, reject) => {
      signal.addEventListener('abort', () => {
        reject(new Error(`Operation timed out after ${timeoutMs}ms`));
      });
    }),
  ]);

  return {
    promise,
    cancel: () => {
      clearTimeout(timer);
      task.cancel();
      controller.abort();
    },
  };
}
