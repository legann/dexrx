import type { ICacheProvider } from '../providers/interfaces/cache';
import type { ILoggerProvider } from '../providers/interfaces/logger';
import type { IEventSourceProvider } from '../providers/interfaces/event-source';
import type { IPersistenceProvider } from '../providers/interfaces/persistence';
import type { INotificationProvider } from '../providers/interfaces/notifications';
import type { ParallelExecutionOptions } from '../types/execution-context';
import type { DataNodesExecutionMode, EngineExecutionMode } from '../types/engine-options';
import type { INodePlugin } from '../types/node-plugin';

/**
 * Execution context for Build API
 * Contains runtime information available to compute functions
 */
export interface ExecutionContext {
  readonly workUnitId?: string;
  readonly userId?: string;
  readonly messageId?: string;
  readonly environment?: 'development' | 'staging' | 'production';
  readonly secrets?: Readonly<Record<string, string>>;
  readonly requestId?: string;
  readonly timestamp?: number;
  readonly logger?: ILoggerProvider;
  readonly parallelOptions?: ParallelExecutionOptions;
  readonly executionMode?: EngineExecutionMode;
  readonly dataNodesExecutionMode?: DataNodesExecutionMode;
  readonly debounceTime?: number;
  readonly distinctValues?: boolean;
  readonly throttleTime?: number;
  readonly enableCancelableCompute?: boolean;
  readonly maxDepth?: number;
  readonly silentErrors?: boolean;
  readonly sanitizeInput?: boolean;
}

/**
 * Provider registry for IoC pattern
 * Contains all registered providers for the graph
 * @category Providers
 */
export interface ProviderRegistry {
  readonly cache?: ICacheProvider;
  readonly logger?: ILoggerProvider;
  readonly eventSource?: IEventSourceProvider;
  readonly persistence?: IPersistenceProvider;
  readonly notifications?: INotificationProvider;
}

// Provider interfaces are now defined in providers/interfaces/
// Re-exported here for convenience and backward compatibility
export type { IEventSourceProvider } from '../providers/interfaces/event-source';
export type { EventMetadata } from '../providers/interfaces/event-source';
export type { IPersistenceProvider } from '../providers/interfaces/persistence';
export type { INotificationProvider } from '../providers/interfaces/notifications';

/**
 * Node definition for Build API
 * Internal representation of a node in the graph
 */
export interface NodeDefinition {
  readonly id: string;
  readonly type: string;
  readonly inputs: readonly string[];
  readonly config: NodeConfig;
  readonly computeFunction?: ComputeFunction;
}

/**
 * Node configuration
 */
export interface NodeConfig {
  readonly [key: string]: unknown;
  readonly isSubscribed?: boolean;
  readonly subscriptionCallback?: (value: unknown, context: ExecutionContext) => void;
  readonly cached?: boolean;
  readonly cacheTtl?: number;
}

/**
 * Compute function signature
 * Function that computes node value from inputs and context
 */
export type ComputeFunction<TConfig = unknown, TInput = unknown, TOutput = unknown> = (
  config: TConfig,
  inputs: readonly TInput[],
  context: ExecutionContext
) => TOutput | Promise<TOutput>;

/**
 * Subscription handler function
 * Called when a subscribed node's value changes
 */
export type SubscriptionHandler = (value: unknown, nodeId: string, nodeType: string) => void;

/**
 * Subscription configuration
 * Can be:
 * 1. Record of nodeId -> handler (specific nodes)
 * 2. Function that receives (nodeId, value, nodeType) for all subscribed nodes
 * 3. Function that receives subscribed nodes array and returns Map of handlers
 */
export type SubscriptionConfig =
  | Record<string, SubscriptionHandler>
  | ((nodeId: string, value: unknown, nodeType: string) => void)
  | ((subscribedNodes: readonly NodeDefinition[]) => Map<string, SubscriptionHandler>);

/**
 * Graph definition for Build API
 * Immutable representation of the computation graph
 */
export interface GraphDefinition {
  readonly nodes: ReadonlyMap<string, NodeDefinition>;
  readonly edges: ReadonlyMap<string, readonly string[]>;
  readonly context: ExecutionContext;
  readonly providers: ProviderRegistry;
  readonly plugins?: ReadonlyMap<string, INodePlugin>;
  readonly runtimeContextFactory?: (
    nodeId: string,
    nodeType: string,
    graph: GraphDefinition
  ) => import('../types/runtime-context').IRuntimeContext;
  readonly subscriptionHandlers?: ReadonlyMap<string, SubscriptionHandler>;
  readonly subscriptionConfig?: SubscriptionConfig;
}

/**
 * Graph operator function
 * Transforms a graph definition, adding nodes, edges, or modifying configuration
 */
export interface GraphOperator {
  (graph: GraphDefinition): GraphDefinition;
}

/**
 * Options for updating graph with new nodes
 */
export interface UpdateGraphOptions {
  /**
   * Automatically start new graph after update
   * @default false
   */
  autoStart?: boolean;

  /**
   * Preserve subscription config and handlers if compatible
   * If true, subscriptions from old graph will be applied to new graph
   * @default false
   */
  preserveSubscriptions?: boolean;
}
