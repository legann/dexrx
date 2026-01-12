// Forward reference types to avoid circular dependency
// These types are defined in graph/operator-types.ts
import type { ExecutionContext } from '../../graph/operator-types';
import type { GraphDefinition } from '../../graph/operator-types';

/**
 * Event metadata extracted from event source
 * @category Providers
 */
export interface EventMetadata {
  readonly workUnitId: string;
  readonly userId?: string;
  readonly messageId?: string;
  readonly payload?: unknown;
}

/**
 * Event source provider interface
 * Generic interface for parsing events and extracting context
 * @category Providers
 */
export interface IEventSourceProvider {
  /**
   * Parse event and extract metadata
   */
  parseEvent(): Promise<EventMetadata>;

  /**
   * Optionally load graph definition from event
   */
  loadGraph?(): Promise<GraphDefinition | null>;

  /**
   * Get execution context from event
   */
  getContext(): ExecutionContext;
}
