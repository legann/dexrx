import { INodePlugin, NodeCategory } from '../types/node-plugin';
import { ExecutionContext } from '../types/execution-context';
import { SKIP_NODE_EXEC } from '../types/engine-flags';
import { NodeConfig } from '../types/utils';

/**
 * Node wrapper interface
 */
export interface NodeWrapper {
  compute(inputs: readonly unknown[]): unknown | Promise<unknown>;
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

  compute(inputs: readonly unknown[]): unknown | Promise<unknown> {
    // Category comes from plugin, fallback to runtime context for backward compatibility
    const category = this.plugin.category ?? this.config.__runtime?.category;

    // Only for operational nodes do async handling
    if (category === 'operational') {
      return this.handleOperationalNode(inputs);
    }

    // For other nodes (data nodes, etc.) - as usual
    return this.plugin.compute(this.config, inputs);
  }

  private async handleOperationalNode(inputs: readonly unknown[]): Promise<unknown> {
    // 1. Wait for all Promises
    const resolvedInputs = await Promise.all(
      inputs.map(input => (input instanceof Promise ? input : Promise.resolve(input)))
    );

    // 2. Check for SKIP_NODE_EXEC
    if (resolvedInputs.some(v => v === SKIP_NODE_EXEC)) {
      const { SkipInputException } = await import('../utils/node-error');
      throw new SkipInputException(this.config.__runtime?.nodeId ?? 'unknown');
    }

    // 3. Execute plugin
    return this.plugin.compute(this.config, resolvedInputs);
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

  async compute(inputs: readonly unknown[]): Promise<unknown> {
    // Category comes from plugin, fallback to runtime context for backward compatibility
    // Note: we need to get plugin from registry via nodeType, but for now use runtime context
    // This will be fixed when we pass plugin reference to wrapper
    const category = this.config.__runtime?.category;

    // Only for operational nodes do Promise handling and null check
    if (category === 'operational') {
      return this.handleOperationalNode(inputs);
    }

    // For other nodes (data nodes, etc.) - as usual
    return this.executionContext.execute(this.nodeType, this.config, inputs);
  }

  private async handleOperationalNode(inputs: readonly unknown[]): Promise<unknown> {
    // 1. Wait for all Promises
    const resolvedInputs = await Promise.all(
      inputs.map(input => (input instanceof Promise ? input : Promise.resolve(input)))
    );

    // 2. Check for SKIP_NODE_EXEC
    if (resolvedInputs.some(v => v === SKIP_NODE_EXEC)) {
      const { SkipInputException } = await import('../utils/node-error');
      throw new SkipInputException(this.config.__runtime?.nodeId ?? 'unknown');
    }

    // 3. Execute plugin through execution context
    return this.executionContext.execute(this.nodeType, this.config, resolvedInputs);
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
