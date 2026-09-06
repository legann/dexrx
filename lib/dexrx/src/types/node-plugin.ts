import type { Observable } from 'rxjs';
import { NodeConfig, NodeValue } from './utils';

/**
 * Node category - determines how the node is processed by the engine
 * - 'data': Data nodes fetch or receive data from external sources (typically no inputs)
 * - 'operational': Operational nodes process and transform data (have inputs)
 * @category Plugin Development
 */
export type NodeCategory = 'data' | 'operational';

/**
 * Node plugin interface with generic type support
 *
 * This is the main interface for creating custom node plugins.
 * Plugins define how nodes compute their values based on configuration and inputs.
 *
 * Contract: compute returns Observable (stream, possibly multi-emit) or plain value (sync single result).
 * No Promise in contract; use Observable (e.g. from(), of()) for async.
 *
 * @template TConfig - Type of node configuration
 * @template TInput - Type of input values
 * @template TOutput - Type of output value
 * @category Plugin Development
 */
export interface INodePlugin<
  TConfig extends NodeConfig = NodeConfig,
  TInput = NodeValue,
  TOutput = NodeValue,
> {
  readonly type: string;
  /**
   * Node category - determines how the node is processed by the engine
   * - 'data': Data nodes fetch or receive data from external sources (typically no inputs)
   * - 'operational': Operational nodes process and transform data (have inputs)
   */
  readonly category: NodeCategory;
  /**
   * Per-type override of the engine's `debounceTime` for this plugin's INPUT pipeline.
   * Absent (`undefined`) keeps the engine-wide `IEngineOptions.debounceTime`; `0` disables
   * debouncing for every node of this type.
   *
   * Debounce is last-value-wins over its window, so it is a rate limiter for VALUE streams.
   * A plugin whose inputs are EVENTS (each emission consumes an outcome that cannot be
   * reconstructed from the next one) must declare `0`: within one window the engine would
   * deliver only the trailing emission and silently drop the rest.
   */
  readonly debounceTime?: number;
  compute(config: TConfig, inputs: readonly TInput[]): Observable<TOutput> | TOutput;
}

/**
 * Type alias for legacy compatibility (non-generic version)
 * Uses unknown instead of any for better type safety
 */
export type UntypedNodePlugin = INodePlugin<NodeConfig, unknown, unknown>;
