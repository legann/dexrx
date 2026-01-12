import { Observable } from 'rxjs';
import { INodeDefinition } from './node-definition';
import { CacheStats } from './cache-types';
import { IGraphDefinition } from './graph-definition';
import { EngineState } from './engine-state';
import { EngineStats } from './engine-stats';
import { EngineEventHandlers, UnsubscribeFn } from './engine-hooks';
import { NodeValue, Serializable } from './utils';
import type { EngineStateSnapshot } from './engine-state-snapshot';

// Re-export NodeState and EngineStateSnapshot from separate file for Build API
export type { NodeState, EngineStateSnapshot } from './engine-state-snapshot';

/**
 * Main interface for reactive graph engine.
 * Provides methods for managing computation graph, observing values,
 * and controlling execution flow.
 *
 * @example
 * ```typescript
 * const registry = new NodeRegistry();
 * registry.register({ type: 'add', compute: (config, inputs) => inputs[0] + inputs[1] });
 *
 * const engine = new ReactiveGraphEngine(registry, {
 *   executionMode: 'parallel', // or EngineExecutionMode.PARALLEL
 *   throttleTime: 100
 * });
 *
 * engine.addNode({ id: 'a', type: 'add', config: { value: 1 } });
 * engine.addNode({ id: 'b', type: 'add', config: { value: 2 } });
 * engine.addNode({ id: 'sum', type: 'add', inputs: ['a', 'b'] });
 *
 * engine.observeNode('sum')?.subscribe(value => console.log(value));
 * ```
 */
export interface IReactiveGraphEngine {
  /**
   * Adds a new node to the computation graph.
   *
   * @param def - Node definition containing id, type, inputs, and config
   * @throws {Error} If node with same id already exists
   * @throws {Error} If cycle is detected in graph dependencies
   *
   * @example
   * ```typescript
   * engine.addNode({
   *   id: 'source',
   *   type: 'fetch',
   *   config: { url: 'https://api.example.com/data' }
   * });
   * ```
   */
  addNode(def: INodeDefinition): void;

  /**
   * Updates existing node
   * @param id Node identifier
   * @param def New node definition
   */
  updateNode(id: string, def: INodeDefinition): void;

  /**
   * Removes node from graph
   * @param id Node identifier
   * @param preserveSubject Preserve subject (for reuse)
   */
  removeNode(id: string, preserveSubject?: boolean): void;

  /**
   * Creates Observable for observing node value
   * @template T - Type of node value (defaults to NodeValue/unknown)
   * @param id Node identifier
   * @returns Observable or undefined if node not found
   */
  observeNode<T = NodeValue>(id: string): Observable<T> | undefined;

  /**
   * Destroys engine and releases resources
   */
  destroy(): void;

  /**
   * Clears cache for specified node or entire engine
   * @param nodeId Node identifier (optional)
   */
  clearCache(nodeId?: string): void;

  /**
   * Returns cache usage statistics
   * @returns Cache statistics or null if cache is not enabled
   */
  getCacheStats(): CacheStats | null;

  /**
   * Performs precomputation of node with given input data
   * @param nodeId Node identifier
   * @param inputs Input data
   */
  precomputeNode(nodeId: string, inputs: readonly unknown[]): Promise<void>;

  /**
   * Exports graph to serializable object
   * @param metadata Additional metadata
   * @returns Graph definition object
   */
  exportGraph(metadata?: Readonly<Record<string, Serializable>>): IGraphDefinition;

  /**
   * Imports graph from serialized object
   * @param graphDef Graph definition
   * @param options Import options
   * @returns Array of imported node identifiers
   */
  importGraph(
    graphDef: IGraphDefinition,
    options?: {
      checkCycles?: boolean;
      conflictStrategy?: 'skip' | 'replace' | 'throw';
    }
  ): string[];

  /**
   * Starts engine, activating update processing
   * @throws Error if engine cannot be started in current state
   */
  start(): void;

  /**
   * Pauses engine without destruction
   * @throws Error if engine cannot be paused in current state
   */
  pause(): void;

  /**
   * Resumes engine after pause
   * @throws Error if engine is not in paused state
   */
  resume(): void;

  /**
   * Stops engine with possibility of subsequent start
   * @throws Error if engine is already destroyed
   */
  stop(): void;

  /**
   * Returns current engine state
   * @returns Current engine state
   */
  getState(): EngineState;

  /**
   * Returns current engine statistics
   * @returns Engine statistics object
   */
  getStats(): EngineStats;

  /**
   * Resets error counters and statistics
   */
  resetStats(): void;

  /**
   * Gets identifiers of all nodes in graph
   * @returns Array of node identifiers
   */
  getNodeIds(): string[];

  /**
   * Subscribes to engine event
   * @param eventType Event type
   * @param handler Event handler
   * @returns Function to unsubscribe
   */
  on<K extends keyof EngineEventHandlers>(
    eventType: K,
    handler: EngineEventHandlers[K]
  ): UnsubscribeFn;

  /**
   * Exports complete engine state for serialization
   * @param includeMetadata Whether to include additional metadata
   * @returns Serializable state object
   */
  exportState(includeMetadata?: boolean): EngineStateSnapshot;

  /**
   * Imports complete engine state from serialized object
   * @param state Serialized state
   * @param options Import options
   * @returns Promise that resolves when state is imported
   */
  importState(
    state: EngineStateSnapshot,
    options?: {
      preserveOptions?: boolean;
      validateTypes?: boolean;
    }
  ): Promise<void>;
}
