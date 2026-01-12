/**
 * Error class for graph nodes
 *
 * Extends standard Error class, adding
 * information about operation execution context
 */
export class NodeError extends Error {
  /**
   * Identifier of node where error occurred
   */
  public readonly nodeId: string;

  /**
   * Original error, if exists
   */
  public readonly originalError?: Error;

  /**
   * Creates new NodeError instance
   * @param message Error message
   * @param nodeId Node identifier
   * @param originalError Original error (optional)
   */
  constructor(message: string, nodeId: string, originalError?: Error) {
    // Call base class constructor
    super(message);

    // Set class name
    this.name = 'NodeError';

    // Save error context
    this.nodeId = nodeId;
    this.originalError = originalError;

    // Set up call stack
    if (originalError?.stack) {
      this.stack = `${this.stack}\nCaused by: ${originalError.stack}`;
    }

    // For ES5 compatibility
    Object.setPrototypeOf(this, NodeError.prototype);
  }

  /**
   * Returns string representation of error
   */
  public override toString(): string {
    return `[NodeError in ${this.nodeId}] ${this.message}`;
  }

  /**
   * Converts error to object for serialization
   */
  toJSON(): {
    readonly name: string;
    readonly message: string;
    readonly nodeId: string;
    readonly originalError?: {
      readonly name: string;
      readonly message: string;
    };
  } {
    return {
      name: this.name,
      message: this.message,
      nodeId: this.nodeId,
      originalError: this.originalError
        ? {
            name: this.originalError.name,
            message: this.originalError.message,
          }
        : undefined,
    };
  }
}

/**
 * Checks if object is NodeError instance
 * @param error Object to check
 * @returns true if object is NodeError instance
 */
export function isNodeError(error: unknown): error is NodeError {
  return error instanceof NodeError;
}

/**
 * Creates new NodeError instance
 * @param message Error message
 * @param nodeId Node identifier
 * @param originalError Original error (optional)
 * @returns New NodeError instance
 */
export function createNodeError(message: string, nodeId: string, originalError?: Error): NodeError {
  return new NodeError(message, nodeId, originalError);
}

/**
 * Exception for cases when operational nodes receive skip on input
 * (when data nodes were not triggered)
 */
export class SkipInputException extends Error {
  public readonly nodeId: string;

  constructor(nodeId: string) {
    super(`Skip input detected in operational node ${nodeId} - some data nodes were not triggered`);
    this.name = 'SkipInputException';
    this.nodeId = nodeId;

    // For ES5 compatibility
    Object.setPrototypeOf(this, SkipInputException.prototype);
  }
}

/**
 * Type guard for SkipInputException
 * @param error Value to check
 * @returns true if value is SkipInputException
 */
export function isSkipInputException(error: unknown): error is SkipInputException {
  return (
    error instanceof SkipInputException ||
    (error instanceof Error && error.name === 'SkipInputException' && 'nodeId' in error)
  );
}

/**
 * Union type of all custom errors
 */
export type EngineError = NodeError | SkipInputException;

/**
 * Type guard for any engine error
 * @param error Value to check
 * @returns true if value is an engine error
 */
export function isEngineError(error: unknown): error is EngineError {
  return isNodeError(error) || isSkipInputException(error);
}

/**
 * Type guard for standard Error
 * @param error Value to check
 * @returns true if value is Error instance
 */
export function isError(error: unknown): error is Error {
  return error instanceof Error;
}

/**
 * Safely extracts error message from unknown error type
 * @param error Error of unknown type
 * @returns Error message string
 */
export function getErrorMessage(error: unknown): string {
  if (isError(error)) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  if (error && typeof error === 'object' && 'message' in error) {
    return String(error.message);
  }
  return String(error);
}
