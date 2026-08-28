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
 * Reader for the node's control-slot: the latest config delta pushed by a
 * controller. Returns undefined when nothing has been pushed.
 */
export type ControlReader = () => NodeConfig | undefined;

/**
 * Overlays the control-slot delta on the captured base config.
 * Empty slot returns the base config unchanged (same reference), so nodes
 * without controllers pay nothing. The base is never mutated.
 */
function withControlOverlay(config: RuntimeConfig, getControl?: ControlReader): RuntimeConfig {
  const slot = getControl?.();
  if (!slot || Object.keys(slot).length === 0) {
    return config;
  }
  return { ...config, ...slot };
}

/**
 * Wrapper for node executing in main thread
 */
class DefaultNodeWrapper implements NodeWrapper {
  constructor(
    private readonly plugin: INodePlugin,
    private readonly config: RuntimeConfig,
    private readonly getControl?: ControlReader
  ) {}

  compute(inputs: readonly unknown[]): Observable<unknown> | unknown {
    const effectiveConfig = withControlOverlay(this.config, this.getControl);
    const category = this.plugin.category ?? this.config.__runtime?.category;

    if (category === 'operational') {
      return this.handleOperationalNode(effectiveConfig, inputs);
    }

    return this.plugin.compute(effectiveConfig, inputs);
  }

  private handleOperationalNode(
    effectiveConfig: RuntimeConfig,
    inputs: readonly unknown[]
  ): Observable<unknown> | unknown {
    // Inputs are already resolved by the pipeline (mergeMap(Promise.all(values)))
    if (inputs.some(v => v === SKIP_NODE_EXEC)) {
      throw new SkipInputException(this.config.__runtime?.nodeId ?? 'unknown');
    }
    return this.plugin.compute(effectiveConfig, inputs);
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
    private readonly executionContext: ExecutionContext,
    private readonly getControl?: ControlReader
  ) {}

  compute(inputs: readonly unknown[]): Promise<unknown> | Observable<unknown> | unknown {
    const category = this.config.__runtime?.category;

    if (category === 'operational') {
      if (inputs.some(v => v === SKIP_NODE_EXEC)) {
        throw new SkipInputException(this.config.__runtime?.nodeId ?? 'unknown');
      }
    }
    // The config crosses a worker postMessage boundary: the injected control
    // writers are functions — not structured-cloneable, they would fail EVERY
    // compute with DataCloneError. Strip them here — imperative pushes are
    // main-thread-only (the plan confines stateful controllers to SERIAL anyway).
    let effectiveConfig = withControlOverlay(this.config, this.getControl);
    if ('__setControl' in effectiveConfig || '__requestConfigUpdate' in effectiveConfig) {
      const { __setControl, __requestConfigUpdate, ...serializable } = effectiveConfig;
      effectiveConfig = serializable;
    }
    // Execution context returns Promise (worker uses firstValueFrom(observable) internally)
    return this.executionContext.execute(this.nodeType, effectiveConfig, inputs);
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
 * @param getControl Optional reader for the node's control-slot (overlaid on config per compute)
 * @returns Node wrapper
 */
export function createNodeWrapper(
  plugin: INodePlugin,
  config: NodeConfig,
  executionContext?: ExecutionContext,
  getControl?: ControlReader
): NodeWrapper {
  // If execution context is provided, use parallel wrapper
  if (executionContext) {
    return new ParallelNodeWrapper(plugin.type, config as RuntimeConfig, executionContext, getControl);
  }

  // Otherwise use default wrapper for main thread
  return new DefaultNodeWrapper(plugin, config as RuntimeConfig, getControl);
}
