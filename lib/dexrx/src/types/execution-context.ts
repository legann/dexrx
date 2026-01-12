import { NodeConfig, NodeValue } from './utils';
import type { ILogger } from './logger';

/**
 * Interface for execution context
 * Provides abstraction for different execution strategies (main thread, parallel, etc.)
 */
export interface ExecutionContext {
  /**
   * Executes plugin with specified options and input data
   * @param pluginType Type of plugin to execute
   * @param configuration Plugin configuration
   * @param inputs Array of input values
   * @returns Promise with computation result
   */
  execute(
    pluginType: string,
    configuration: NodeConfig,
    inputs: readonly unknown[]
  ): Promise<NodeValue>;

  /**
   * Terminates execution context and releases resources
   */
  terminate(): void;
}

/**
 * Options for parallel execution
 */
export interface ParallelExecutionOptions {
  /**
   * Maximum number of workers (default: CPU cores - 1, min 2)
   */
  readonly maxWorkers?: number;

  /**
   * Minimum complexity for parallel execution
   * Tasks below this threshold run in main thread
   */
  readonly minComplexity?: number;

  /**
   * URL for Web Worker script (browser only)
   */
  readonly workerScriptUrl?: string;

  /**
   * Timeout for worker task in milliseconds (default: 30000ms)
   */
  readonly workerTimeout?: number;

  /**
   * Path to Node.js worker file (Node.js only)
   */
  readonly workerPath?: string;

  /**
   * Optional logger instance for debugging execution context
   */
  readonly logger?: ILogger;
}
