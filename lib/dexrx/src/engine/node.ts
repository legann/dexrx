import type { Observable } from 'rxjs';
import { INodePlugin, NodeCategory } from '../types/node-plugin';
import { ExecutionContext } from '../types/execution-context';
import { SKIP_NODE_EXEC } from '../types/engine-flags';
import { NodeConfig } from '../types/utils';
import { SkipInputException } from '../utils/node-error';

/**
 * Node wrapper interface.
 * Plugin compute() returns Observable | value. Wrapper returns the same;
 * in parallel mode execution context may return Promise (adapter), engine normalizes via toObservable.
 */
export interface NodeWrapper {
  compute(inputs: readonly unknown[]): Observable<unknown> | Promise<unknown> | unknown;
  destroy(): void;
}

/**
 * Runtime config extension (internal use only)
 */
interface RuntimeConfig extends NodeConfig {
  __runtime?: {
    category?: NodeCategory;
    nodeId?: string;
  };
}

/**
 * Wrapper for node executing in main thread
 */
class DefaultNodeWrapper implements NodeWrapper {
  constructor(
    private readonly plugin: INodePlugin,
    private readonly config: RuntimeConfig
  ) {}

  compute(inputs: readonly unknown[]): Observable<unknown> | unknown {
    const category = this.plugin.category ?? this.config.__runtime?.category;

    if (category === 'operational') {
      return this.handleOperationalNode(inputs);
    }

    return this.plugin.compute(this.config, inputs) as Observable<unknown> | unknown;
  }

  private handleOperationalNode(inputs: readonly unknown[]): Observable<unknown> | unknown {
    // Inputs are already resolved by the pipeline (mergeMap(Promise.all(values)))
    if (inputs.some(v => v === SKIP_NODE_EXEC)) {
      throw new SkipInputException(this.config.__runtime?.nodeId ?? 'unknown');
    }
    return this.plugin.compute(this.config, inputs) as Observable<unknown> | unknown;
  }

  destroy(): void {
    // Check if plugin has destroy method
    const pluginWithDestroy = this.plugin as unknown as { destroy?: () => void };
    if (typeof pluginWithDestroy.destroy === 'function') {
      pluginWithDestroy.destroy();
    }
  }
}

/**
 * Wrapper for node executing in parallel context
 */
class ParallelNodeWrapper implements NodeWrapper {
  constructor(
    private readonly nodeType: string,
    private readonly config: RuntimeConfig,
    private readonly executionContext: ExecutionContext
  ) {}

  compute(inputs: readonly unknown[]): Promise<unknown> | Observable<unknown> | unknown {
    const category = this.config.__runtime?.category;

    if (category === 'operational') {
      if (inputs.some(v => v === SKIP_NODE_EXEC)) {
        throw new SkipInputException(this.config.__runtime?.nodeId ?? 'unknown');
      }
    }
    // Execution context returns Promise (worker uses firstValueFrom(observable) internally)
    return this.executionContext.execute(this.nodeType, this.config, inputs);
  }

  destroy(): void {
    // No additional cleanup needed, ExecutionContext handles it
  }
}

/**
 * Creates node wrapper depending on execution mode
 * @param plugin Node plugin
 * @param config Node configuration
 * @param executionContext Optional execution context for parallel mode
 * @returns Node wrapper
 */
export function createNodeWrapper(
  plugin: INodePlugin,
  config: NodeConfig,
  executionContext?: ExecutionContext
): NodeWrapper {
  // If execution context is provided, use parallel wrapper
  if (executionContext) {
    return new ParallelNodeWrapper(plugin.type, config as RuntimeConfig, executionContext);
  }

  // Otherwise use default wrapper for main thread
  return new DefaultNodeWrapper(plugin, config as RuntimeConfig);
}
