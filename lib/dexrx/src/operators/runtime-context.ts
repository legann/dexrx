import type { GraphOperator, GraphDefinition } from '../graph';
import type { IRuntimeContext } from '../types/runtime-context';

/**
 * Adds runtime context to all nodes in the graph
 * Runtime context is added to node config as __runtime field
 * dataNodesExecutionMode is automatically added from graph context (set by withEngineOptions) if not explicitly provided
 *
 * @param contextFactory - Function that generates runtime context for each node
 *                         Receives (nodeId, nodeType, graph) - graph provides access to context.dataNodesExecutionMode
 *                         You don't need to include dataNodesExecutionMode - it's added automatically
 *
 * @example
 * ```typescript
 * const graph = createGraph(
 *   withEngineOptions({ dataNodesExecutionMode: DataNodesExecutionMode.ASYNC_EXEC_MODE }),
 *   withRuntimeContext((nodeId, nodeType, graph) => ({
 *     nodeId,
 *     workUnitId: 'work-123',
 *     messageId: 'msg-456'
 *     // category is automatically determined from plugin definition
 *     // dataNodesExecutionMode is automatically added from graph.context
 *   })),
 *   withNodes(nodes)
 * );
 * ```
 */
export function withRuntimeContext(
  contextFactory: (
    nodeId: string,
    nodeType: string,
    graph: GraphDefinition
  ) => Partial<IRuntimeContext>
): GraphOperator {
  return graph => ({
    ...graph,
    runtimeContextFactory: (
      nodeId: string,
      nodeType: string,
      currentGraph: GraphDefinition
    ): IRuntimeContext => {
      // Use currentGraph (passed at runtime) instead of graph (captured at operator creation)
      // This ensures we always use the latest graph state, including context.dataNodesExecutionMode
      const userContext = contextFactory(nodeId, nodeType, currentGraph);
      // Automatically add dataNodesExecutionMode from current graph context if not explicitly provided
      if (!userContext.dataNodesExecutionMode && currentGraph.context.dataNodesExecutionMode) {
        return {
          ...userContext,
          dataNodesExecutionMode: currentGraph.context.dataNodesExecutionMode,
        } as IRuntimeContext;
      }
      return userContext as IRuntimeContext;
    },
  });
}
