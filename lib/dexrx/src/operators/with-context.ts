import type { GraphOperator, ExecutionContext } from '../graph';

/**
 * Sets execution context for the graph
 * Provides execution context values directly (workUnitId, userId, secrets, etc.)
 *
 * @param context - Execution context values
 *
 * @example
 * ```typescript
 * const graph = createGraph(
 *   withExecutionContextProvider({
 *     workUnitId: 'work-123',
 *     userId: 'user-456',
 *     environment: 'production',
 *     secrets: { apiKey: 'secret-key' }
 *   }),
 *   source('data', async (ctx) => fetchData(ctx.secrets?.apiKey))
 * );
 * ```
 */
export function withExecutionContextProvider(context: Partial<ExecutionContext>): GraphOperator {
  return graph => ({
    ...graph,
    context: {
      ...graph.context,
      ...context,
    },
  });
}
