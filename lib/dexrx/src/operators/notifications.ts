import type { GraphOperator } from '../graph';
import type { INotificationProvider } from '../providers/interfaces';

/**
 * Registers a notification provider for the graph
 * Notification provider allows sending notifications and broadcasts
 *
 * @param provider - Notification provider instance
 * @category Providers
 *
 * @example
 * ```typescript
 * class WebSocketNotificationProvider implements INotificationProvider {
 *   async notify(connectionId, data) {
 *     // Send to specific connection
 *   }
 *   async broadcast(topic, data) {
 *     // Broadcast to topic
 *   }
 * }
 *
 * const graph = createGraph(
 *   withNotifications(new WebSocketNotificationProvider()),
 *   withNodes(nodes) // Nodes with isSubscribed: true will trigger notifications via subscriptionCallback
 * );
 * ```
 */
export function withNotifications(provider: INotificationProvider): GraphOperator {
  return graph => ({
    ...graph,
    providers: {
      ...graph.providers,
      notifications: provider,
    },
  });
}
