import { ICancelableComputation } from './cancelable-computation';
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
  compute(
    config: TConfig,
    inputs: readonly TInput[]
  ): TOutput | Promise<TOutput> | ICancelableComputation<TOutput>;
}

/**
 * Type alias for legacy compatibility (non-generic version)
 * Uses unknown instead of any for better type safety
 */
export type UntypedNodePlugin = INodePlugin<NodeConfig, unknown, unknown>;
