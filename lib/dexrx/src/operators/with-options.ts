import type { GraphOperator, GraphDefinition } from '../graph';
import type { IRuntimeContext } from '../types/runtime-context';
import type { IEngineOptionsExtended } from './engine-options';
import type { ExecutionContext } from '../graph';
import { withEngineOptions } from './engine-options';
import { withRuntimeContext } from './runtime-context';
import { withExecutionContextProvider } from './with-context';

/**
 * Runtime context factory type
 * Receives (nodeId, nodeType, graph) and returns partial runtime context
 */
export type RuntimeContextFactory = (
  nodeId: string,
  nodeType: string,
  graph: GraphDefinition
) => Partial<IRuntimeContext>;

/**
 * Unified graph options
 * Combines engine options, runtime context, and execution context
 * Ensures correct composition order internally
 */
export interface GraphOptions {
  /**
   * Engine options (execution mode, debounce, throttle, etc.)
   * These options are applied first, so runtimeContext can access dataNodesExecutionMode
   */
  engine?: IEngineOptionsExtended;

  /**
   * Runtime context factory for nodes
   * Receives (nodeId, nodeType, graph) and returns IRuntimeContext
   * dataNodesExecutionMode is automatically added from engine.dataNodesExecutionMode
   * if not explicitly provided in the return value
   *
   * @example
   * ```typescript
   * runtimeContext: (nodeId, nodeType, graph) => ({
   *   nodeId,
   *   workUnitId: 'work-123',
   *   messageId: 'msg-456'
   *   // dataNodesExecutionMode automatically added from engine options
   * })
   * ```
   */
  runtimeContext?: RuntimeContextFactory;

  /**
   * Execution context (workUnitId, userId, secrets, etc.)
   * Applied before engine options
   */
  executionContext?: Partial<ExecutionContext>;
}

/**
 * Unified operator for engine options and runtime context
 * Ensures correct composition order: executionContext -> engine -> runtimeContext
 * This eliminates closure issues and ensures runtimeContext has access to engine.dataNodesExecutionMode
 *
 * @param options - Graph options object
 * @throws Error if options is empty or invalid
 *
 * @example
 * ```typescript
 * const graph = createGraph(
 *   withNodePlugins(plugins),
 *   withOptions({
 *     engine: {
 *       dataNodesExecutionMode: DataNodesExecutionMode.ASYNC_EXEC_MODE,
 *       debounceTime: 10
 *     },
 *     runtimeContext: (nodeId, nodeType, graph) => ({
 *       nodeId,
 *       workUnitId: 'work-123',
 *       messageId: 'msg-456'
 *       // dataNodesExecutionMode automatically added from engine options
 *     }),
 *     executionContext: {
 *       workUnitId: 'work-123',
 *       userId: 'user-456'
 *     }
 *   }),
 *   withNodes(nodes)
 * );
 * ```
 */
export function withOptions(options: GraphOptions): GraphOperator {
  // Validation
  if (!options || typeof options !== 'object') {
    throw new Error('withOptions: options must be an object');
  }

  const hasEngine = options.engine !== undefined && options.engine !== null;
  const hasRuntimeContext = options.runtimeContext !== undefined && options.runtimeContext !== null;
  const hasExecutionContext =
    options.executionContext !== undefined && options.executionContext !== null;

  if (!hasEngine && !hasRuntimeContext && !hasExecutionContext) {
    throw new Error(
      'withOptions: at least one of engine, runtimeContext, or executionContext must be provided'
    );
  }

  if (options.runtimeContext && typeof options.runtimeContext !== 'function') {
    throw new Error('withOptions: runtimeContext must be a function');
  }

  if (options.executionContext && typeof options.executionContext !== 'object') {
    throw new Error('withOptions: executionContext must be an object');
  }

  return graph => {
    let currentGraph = graph;

    // 1. Apply execution context first (if provided)
    // This sets base context that engine options can extend
    if (hasExecutionContext && options.executionContext) {
      currentGraph = withExecutionContextProvider(options.executionContext)(currentGraph);
    }

    // 2. Apply engine options (sets dataNodesExecutionMode in context)
    // This must be before runtimeContext so runtimeContext can access it
    if (hasEngine && options.engine) {
      currentGraph = withEngineOptions(options.engine)(currentGraph);
    }

    // 3. Apply runtime context (can use dataNodesExecutionMode from engine options)
    // runtimeContextFactory receives currentGraph which includes engine options
    if (hasRuntimeContext && options.runtimeContext) {
      currentGraph = withRuntimeContext(options.runtimeContext)(currentGraph);
    }

    return currentGraph;
  };
}
