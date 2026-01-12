import type { GraphOperator } from '../graph';
import type { ILoggerProvider } from '../providers/interfaces/logger';

/**
 * Registers a logger provider for the graph
 *
 * @param provider - Logger provider instance
 * @category Providers
 *
 * @example
 * ```typescript
 * const graph = createGraph(
 *   withLoggerProvider(new ConsoleLoggerProvider({ level: LogLevel.INFO })),
 *   source('data', async (ctx) => {
 *     ctx.logger?.info('Fetching data');
 *     return await fetchData();
 *   })
 * );
 * ```
 */
export function withLoggerProvider(provider: ILoggerProvider): GraphOperator {
  return graph => ({
    ...graph,
    providers: {
      ...graph.providers,
      logger: provider,
    },
    context: {
      ...graph.context,
      logger: provider,
    },
  });
}
