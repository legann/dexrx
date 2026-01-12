/**
 * Notification provider interface
 * Generic interface for sending notifications
 * @category Providers
 */
export interface INotificationProvider {
  /**
   * Send notification to specific connection
   */
  notify(connectionId: string, data: unknown): Promise<void>;

  /**
   * Broadcast to topic
   */
  broadcast(topic: string, data: unknown): Promise<void>;

  /**
   * Subscribe connection to topic
   */
  subscribe(connectionId: string, topic: string): Promise<void>;

  /**
   * Unsubscribe connection from topic
   */
  unsubscribe(connectionId: string, topic: string): Promise<void>;
}
