import type { GraphOperator } from '../graph';
import type { IEventSourceProvider } from '../providers/interfaces';

/**
 * Registers an event context provider for the graph
 * Event context provider extracts execution context and metadata from events (Lambda, HTTP, SQS, etc.)
 *
 * @param provider - Event context provider instance
 * @category Providers
 *
 * @example
 * ```typescript
 * class MyEventContextProvider implements IEventSourceProvider {
 *   async parseEvent() {
 *     return { workUnitId: 'work-123', userId: 'user-456' };
 *   }
 *   getContext() {
 *     return { workUnitId: 'work-123' };
 *   }
 * }
 *
 * const graph = createGraph(
 *   withEventContextProvider(new MyEventContextProvider(event)),
 *   source('data', async (ctx) => loadData(ctx))
 * );
 * ```
 */
export function withEventContextProvider(provider: IEventSourceProvider): GraphOperator {
  return graph => {
    // Get context synchronously (parseEvent can be called later if needed)
    const context = provider.getContext();

    return {
      ...graph,
      providers: {
        ...graph.providers,
        eventSource: provider,
      },
      context: {
        ...graph.context,
        ...context,
      },
    };
  };
}
