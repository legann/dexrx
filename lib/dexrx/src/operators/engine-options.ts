import type { GraphOperator } from '../graph';
import type {
  IEngineOptions,
  DataNodesExecutionMode,
  EngineExecutionMode,
} from '../types/engine-options';

/**
 * Extended options for withEngineOptions that includes dataNodesExecutionMode
 */
export interface IEngineOptionsExtended extends Partial<IEngineOptions> {
  /**
   * Data nodes execution mode
   */
  dataNodesExecutionMode?: DataNodesExecutionMode;

  /**
   * Engine execution mode (SERIAL or PARALLEL)
   * Stored in graph context for use in createGraphEngine
   */
  executionMode?: EngineExecutionMode;
}

/**
 * Sets engine options for graph execution
 * dataNodesExecutionMode is stored in graph context
 *
 * @param options - Partial engine options to apply
 *
 * @example
 * ```typescript
 * const graph = createGraph(
 *   withEngineOptions({
 *     dataNodesExecutionMode: DataNodesExecutionMode.ASYNC_EXEC_MODE,
 *     debounceTime: 10,
 *     distinctValues: false,
 *     throttleTime: 100
 *   }),
 *   withNodes(nodes)
 * );
 * ```
 */
export function withEngineOptions(options: IEngineOptionsExtended): GraphOperator {
  return graph => ({
    ...graph,
    context: {
      ...graph.context,
      dataNodesExecutionMode: options.dataNodesExecutionMode,
      debounceTime: options.debounceTime,
      distinctValues: options.distinctValues,
      throttleTime: options.throttleTime,
      enableCancelableCompute: options.enableCancelableCompute,
      maxDepth: options.maxDepth,
      silentErrors: options.silentErrors,
      sanitizeInput: options.sanitizeInput,
      // Store executionMode in context for use in createGraphEngine
      executionMode: options.executionMode,
    },
  });
}
