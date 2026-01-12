import type { IEventSourceProvider, EventMetadata } from '../interfaces/event-source';
import type { ExecutionContext } from '../../graph/operator-types';
import type { GraphDefinition } from '../../graph/operator-types';

/**
 * Memory event source provider implementation
 * Simple in-memory implementation for development and testing
 * @category Providers
 */
export class MemoryEventSourceProvider implements IEventSourceProvider {
  constructor(
    private readonly metadata: EventMetadata,
    private readonly context: ExecutionContext,
    private readonly graphDefinition?: GraphDefinition
  ) {}

  async parseEvent(): Promise<EventMetadata> {
    return this.metadata;
  }

  async loadGraph(): Promise<GraphDefinition | null> {
    return this.graphDefinition ?? null;
  }

  getContext(): ExecutionContext {
    return this.context;
  }
}
