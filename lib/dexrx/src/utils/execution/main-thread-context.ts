import { ExecutionContext } from '../../types/execution-context';
import { NodeRegistry } from '../../engine/registry';

/**
 * Execution context implementation for main thread.
 * Used for sequential node execution or when parallel execution is unavailable.
 */
export class MainThreadContext implements ExecutionContext {
  private readonly registry: NodeRegistry;

  /**
   * @param registry Plugin registry for getting necessary handlers
   */
  constructor(registry: NodeRegistry) {
    this.registry = registry;
  }

  /**
   * Executes plugin computation in main thread
   * @param nodeType Node / plugin type
   * @param config Node configuration
   * @param inputs Array of input values
   * @returns Computation result (wrapped in Promise)
   */
  async execute(nodeType: string, config: unknown, inputs: unknown[]): Promise<unknown> {
    try {
      const plugin = this.registry.get(nodeType);

      if (!plugin) {
        throw new Error(`Plugin not found: ${nodeType}`);
      }

      // Execute plugin computation directly
      const result = plugin.compute(config as import('../../types/utils').NodeConfig, inputs);

      // If result is already a Promise, return it as is
      if (result instanceof Promise) {
        return result;
      }

      // Otherwise wrap in Promise.resolve for interface unification
      return Promise.resolve(result);
    } catch (error) {
      return Promise.reject(error);
    }
  }

  /**
   * Executes task represented as object
   * @param task Task object with nodeType, config and inputs fields
   * @returns Task execution result
   */
  async executeTask(task: {
    nodeType: string;
    config: unknown;
    inputs: unknown[];
  }): Promise<unknown> {
    return this.execute(task.nodeType, task.config, task.inputs);
  }

  /**
   * Releases resources (this implementation does nothing)
   */
  terminate(): void {
    // In main thread there are no separate resources to release
  }
}
