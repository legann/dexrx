import type { GraphOperator } from '../graph';
import type { ICacheProvider } from '../providers/interfaces/cache';

/**
 * Registers a cache provider for the graph
 * Cache provider allows caching node computation results
 *
 * @param provider - Cache provider instance
 * @category Providers
 */
export function withCacheProvider(provider: ICacheProvider): GraphOperator {
  return graph => ({
    ...graph,
    providers: {
      ...graph.providers,
      cache: provider,
    },
  });
}
