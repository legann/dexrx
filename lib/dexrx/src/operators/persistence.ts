import type { GraphOperator } from '../graph';
import type { IPersistenceProvider } from '../providers/interfaces';

/**
 * Registers a persistence provider for the graph
 * Persistence provider allows saving/loading graph state
 *
 * @param provider - Persistence provider instance
 * @category Providers
 *
 * @example
 * ```typescript
 * const graph = createGraph(
 *   withPersistence(new MemoryStateProvider()),
 *   source('data', async (ctx) => {
 *     const saved = await ctx.persistence?.loadState('data');
 *     return saved || fetchData();
 *   })
 * );
 * ```
 */
export function withPersistence(provider: IPersistenceProvider): GraphOperator {
  return graph => ({
    ...graph,
    providers: {
      ...graph.providers,
      persistence: provider,
    },
  });
}
