import {
  EngineEventHandlers,
  EngineEventType,
  IHookManager,
  UnsubscribeFn,
} from '../types/engine-hooks';
import { LoggerManager } from '../utils/logging';

// Type for any event handler - union of all possible event handlers
type AnyEventHandler = EngineEventHandlers[keyof EngineEventHandlers];

/**
 * Hook manager for engine.
 * Provides ability to register/cancel hooks and support for multiple handlers.
 */
export class HookManager implements IHookManager {
  private readonly handlers = new Map<keyof EngineEventHandlers, Set<AnyEventHandler>>();

  /**
   * Creates new hook manager instance
   */
  constructor() {
    // Initialize empty sets for all event types
    Object.values(EngineEventType).forEach(eventType => {
      this.handlers.set(eventType, new Set());
    });
  }

  /**
   * Registers handler for specified event
   * @param eventType Event type
   * @param handler Event handler
   * @returns Function to cancel registration
   */
  public on<K extends keyof EngineEventHandlers>(
    eventType: K,
    handler: EngineEventHandlers[K]
  ): UnsubscribeFn {
    const handlers = this.handlers.get(eventType);

    if (!handlers) {
      LoggerManager.warn(`Attempt to subscribe to unknown event: ${String(eventType)}`);
      return () => {
        /* Empty unsubscribe function */
      };
    }

    handlers.add(handler);

    // Return function to unsubscribe
    return () => {
      handlers.delete(handler);
    };
  }

  /**
   * Calls all handlers for specified event
   * @param eventType Event type
   * @param args Arguments to pass to handlers
   */
  public emit<K extends keyof EngineEventHandlers>(
    eventType: K,
    ...args: Parameters<EngineEventHandlers[K]>
  ): void {
    const handlers = this.handlers.get(eventType);

    if (!handlers || handlers.size === 0) {
      return; // No handlers for this event
    }

    // Call all handlers
    handlers.forEach(handler => {
      try {
        Reflect.apply(handler as EngineEventHandlers[K], undefined, args);
      } catch (error) {
        LoggerManager.error(
          `Error in event handler ${String(eventType)}: ${error instanceof Error ? error.message : String(error)}`,
          error instanceof Error ? error : undefined
        );
      }
    });
  }

  /**
   * Cancels all subscriptions to specified event
   * @param eventType Event type
   */
  public clearEvent(eventType: keyof EngineEventHandlers): void {
    const handlers = this.handlers.get(eventType);

    if (handlers) {
      handlers.clear();
    }
  }

  /**
   * Cancels all subscriptions to all events
   */
  public clearAllEvents(): void {
    this.handlers.forEach(handlers => handlers.clear());
  }

  /**
   * Checks if there are handlers for specified event
   * @param eventType Event type
   * @returns true if there is at least one handler
   */
  public hasHandlers(eventType: keyof EngineEventHandlers): boolean {
    const handlers = this.handlers.get(eventType);
    return !!handlers && handlers.size > 0;
  }
}
