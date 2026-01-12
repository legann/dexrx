import type { GraphOperator, SubscriptionHandler, SubscriptionConfig } from '../graph';

// Re-export SubscriptionConfig for convenience
export type { SubscriptionConfig };

/**
 * Adds subscription handlers for subscribed nodes
 * Automatically subscribes to all nodes with isSubscribed: true
 *
 * **Use cases:**
 * - ✅ **Long-running graphs (`run()` mode)**: Essential for reacting to value changes over time
 * - ⚠️ **One-shot computations (`start() + waitForStabilization()` mode)**: Optional - results are typically obtained via `exportState()` after stabilization
 *
 * @param config - Subscription configuration:
 *   - Record<string, handler>: specific node handlers
 *   - Function(nodeId, value, nodeType): handler for all subscribed nodes
 *   - Function(subscribedNodes): returns Map of handlers for subscribed nodes
 *
 * @example
 * ```typescript
 * // Long-running graph - subscriptions are essential
 * const graph = createGraph(
 *   withNodesConfig({
 *     nodesPlugins: [fetchPlugin, mathPlugin],
 *     nodes: [
 *       { id: 'fetch1', type: 'fetch', config: { url: '...', poll: 60 } },
 *       { id: 'math1', type: 'math', inputs: ['fetch1'], config: { isSubscribed: true } }
 *     ],
 *     subscriptions: {
 *       math1: (value) => sendToWebSocket(value) // Called whenever math1 recalculates
 *     }
 *   })
 * );
 * graph.run(); // Graph keeps running, subscriptions emit results
 *
 * // One-shot computation - subscriptions are optional
 * const graph2 = createGraph(
 *   withNodesConfig({
 *     nodesPlugins: [fetchPlugin, mathPlugin],
 *     nodes: [
 *       { id: 'fetch1', type: 'fetch', config: { url: '...' } },
 *       { id: 'math1', type: 'math', inputs: ['fetch1'], config: { isSubscribed: true } }
 *     ]
 *     // No subscriptions needed - results obtained via exportState()
 *   })
 * );
 * graph2.start();
 * await graph2.waitForStabilization();
 * const result = graph2.exportState(); // Get results from state
 * ```
 */
export function withSubscription(config: SubscriptionConfig): GraphOperator {
  return graph => {
    // Merge with existing handlers if any (for Record type)
    const existingHandlers = graph.subscriptionHandlers
      ? new Map(graph.subscriptionHandlers)
      : new Map<string, SubscriptionHandler>();

    // Process Record type immediately (specific node handlers)
    if (typeof config !== 'function') {
      // Record: { nodeId: handler }
      for (const [nodeId, handler] of Object.entries(config)) {
        existingHandlers.set(nodeId, handler);
      }
    }

    // Store config for dynamic processing in applySubscriptions()
    // Functions (handler or generator) will be processed when graph starts
    // Note: Functions may capture external context via closures, which is fine as they're
    // called at graph.start() time when the graph is fully constructed
    return {
      ...graph,
      subscriptionHandlers: existingHandlers.size > 0 ? existingHandlers : undefined,
      subscriptionConfig: config,
    };
  };
}
