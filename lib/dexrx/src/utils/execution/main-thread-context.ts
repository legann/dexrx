import { firstValueFrom } from 'rxjs';
import type { Observable } from 'rxjs';
import { ExecutionContext } from '../../types/execution-context';
import { NodeRegistry } from '../../engine/registry';

function isObservable(x: unknown): x is Observable<unknown> {
  return x != null && typeof x === 'object' && typeof (x as { subscribe?: unknown }).subscribe === 'function';
}

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
   * Executes plugin computation in main thread.
   * Plugin returns Observable | value; we return Promise (first value for Observable).
   */
  async execute(nodeType: string, config: unknown, inputs: unknown[]): Promise<unknown> {
    try {
      const plugin = this.registry.get(nodeType);

      if (!plugin) {
        throw new Error(`Plugin not found: ${nodeType}`);
      }

      const result = plugin.compute(config as import('../../types/utils').NodeConfig, inputs);

      if (isObservable(result)) {
        return firstValueFrom(result);
      }
      if (result instanceof Promise) {
        return result;
      }
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
