import type { INotificationProvider } from '../interfaces/notifications';

/**
 * Memory notification provider implementation
 * Simple in-memory implementation for development and testing
 * Stores notifications in memory (useful for testing)
 * @category Providers
 */
export class MemoryNotificationProvider implements INotificationProvider {
  private readonly notifications: Array<{
    type: 'notify' | 'broadcast';
    target: string;
    data: unknown;
    timestamp: number;
  }> = [];

  private readonly subscriptions = new Map<string, Set<string>>(); // connectionId -> Set<topic>

  async notify(connectionId: string, data: unknown): Promise<void> {
    this.notifications.push({
      type: 'notify',
      target: connectionId,
      data,
      timestamp: Date.now(),
    });
  }

  async broadcast(topic: string, data: unknown): Promise<void> {
    this.notifications.push({
      type: 'broadcast',
      target: topic,
      data,
      timestamp: Date.now(),
    });
  }

  async subscribe(connectionId: string, topic: string): Promise<void> {
    if (!this.subscriptions.has(connectionId)) {
      this.subscriptions.set(connectionId, new Set());
    }
    const topics = this.subscriptions.get(connectionId);
    if (topics) {
      topics.add(topic);
    }
  }

  async unsubscribe(connectionId: string, topic: string): Promise<void> {
    const topics = this.subscriptions.get(connectionId);
    if (topics) {
      topics.delete(topic);
      if (topics.size === 0) {
        this.subscriptions.delete(connectionId);
      }
    }
  }

  /**
   * Get all notifications (for testing)
   */
  getNotifications(): Array<{
    type: 'notify' | 'broadcast';
    target: string;
    data: unknown;
    timestamp: number;
  }> {
    return [...this.notifications];
  }

  /**
   * Clear notifications (for testing)
   */
  clearNotifications(): void {
    this.notifications.length = 0;
  }

  /**
   * Get subscriptions (for testing)
   */
  getSubscriptions(): Map<string, Set<string>> {
    return new Map(this.subscriptions);
  }
}
