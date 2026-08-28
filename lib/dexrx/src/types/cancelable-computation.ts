/**
 * Interface for cancelable operation.
 * @deprecated No longer used. Cancellation was removed in the Promise->Observable migration;
 * a node's compute returns `Observable<T> | T` and is cancelled by unsubscribe. This type and
 * the `enableCancelableCompute` option are retained only for backward compatibility and will
 * be removed in a future major version.
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
