/**
 * Interface for cancelable operation
 * Represents a task that can be cancelled during execution
 * Used in combination with enableCancelableCompute option
 */
export interface ICancelableComputation<T = unknown> {
  /**
   * Promise representing async operation that can be cancelled
   */
  readonly promise: Promise<T>;

  /**
   * Function to cancel current operation
   */
  cancel: () => void;
}

/**
 * Checks if result is cancelable task
 * @param result Result to check
 * @returns true if result is cancelable task
 */
export function isCancelableComputation<T>(result: unknown): result is ICancelableComputation<T> {
  if (result === null || typeof result !== 'object') {
    return false;
  }

  const obj = result as Record<string, unknown>;

  return (
    'promise' in obj &&
    'cancel' in obj &&
    typeof obj.promise === 'object' &&
    obj.promise !== null &&
    'then' in obj.promise &&
    typeof (obj.promise as { then?: unknown }).then === 'function' &&
    typeof obj.cancel === 'function'
  );
}
