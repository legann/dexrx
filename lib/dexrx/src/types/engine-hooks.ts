import { INodeDefinition } from './node-definition';
import { EngineState } from './engine-state';
import { EngineStats, EngineMemoryStats } from './engine-stats';
import { IEngineOptions } from './engine-options';

/**
 * Types of all engine events
 */
export enum EngineEventType {
  // Node events
  NODE_ADDED = 'nodeAdded',
  NODE_REMOVED = 'nodeRemoved',
  NODE_UPDATED = 'nodeUpdated',
  NODE_COMPUTE_ERROR = 'nodeComputeError',
  NODE_SKIP_COMPUTATION = 'nodeSkipComputation',

  // Lifecycle events
  ENGINE_INITIALIZED = 'engineInitialized',
  ENGINE_STARTED = 'engineStarted',
  ENGINE_PAUSED = 'enginePaused',
  ENGINE_RESUMED = 'engineResumed',
  ENGINE_STATE_CHANGED = 'engineStateChanged',
  BEFORE_DESTROY = 'beforeDestroy',
  AFTER_DESTROY = 'afterDestroy',
  ENGINE_RESTORED = 'engineRestored',

  // Monitoring events
  HEALTH_CHECK = 'healthCheck',
  ERROR_THRESHOLD_EXCEEDED = 'errorThresholdExceeded',
  MEMORY_THRESHOLD_EXCEEDED = 'memoryThresholdExceeded',
}

/**
 * Handler type for each event
 */
export interface EngineEventHandlers {
  [EngineEventType.NODE_ADDED]: (nodeId: string, def: INodeDefinition) => void;
  [EngineEventType.NODE_REMOVED]: (nodeId: string) => void;
  [EngineEventType.NODE_UPDATED]: (
    nodeId: string,
    oldDef: INodeDefinition,
    newDef: INodeDefinition
  ) => void;
  [EngineEventType.NODE_COMPUTE_ERROR]: (nodeId: string, error: Error) => void;
  [EngineEventType.NODE_SKIP_COMPUTATION]: (nodeId: string) => void;
  [EngineEventType.ENGINE_INITIALIZED]: (options: IEngineOptions) => void;
  [EngineEventType.ENGINE_STARTED]: (previousState: EngineState) => void;
  [EngineEventType.ENGINE_PAUSED]: () => void;
  [EngineEventType.ENGINE_RESUMED]: () => void;
  [EngineEventType.ENGINE_STATE_CHANGED]: (
    previousState: EngineState,
    newState: EngineState
  ) => void;
  [EngineEventType.BEFORE_DESTROY]: () => void;
  [EngineEventType.AFTER_DESTROY]: () => void;
  [EngineEventType.ENGINE_RESTORED]: (data: {
    engineId: string;
    nodeCount: number;
    previousState: EngineState;
    currentState: EngineState;
  }) => void;
  [EngineEventType.HEALTH_CHECK]: (data: {
    engineId: string;
    stats: EngineStats;
    memory: EngineMemoryStats;
    state: EngineState;
  }) => void;
  [EngineEventType.ERROR_THRESHOLD_EXCEEDED]: (data: {
    errorCount: number;
    threshold: number;
    timeWindowMs: number;
  }) => void;
  [EngineEventType.MEMORY_THRESHOLD_EXCEEDED]: (data: {
    usedMemory: number;
    threshold: number;
    memoryLimit?: number;
  }) => void;
}

/**
 * Function type for hook unregistration
 */
export type UnsubscribeFn = () => void;

/**
 * Interface for hook management
 */
export interface IHookManager {
  /**
   * Subscribe to event with cancellation capability
   * @param eventType Event type
   * @param handler Event handler
   * @returns Function to unsubscribe
   */
  on<K extends keyof EngineEventHandlers>(
    eventType: K,
    handler: EngineEventHandlers[K]
  ): UnsubscribeFn;

  /**
   * Call all handlers for specified event
   * @param eventType Event type
   * @param args Event arguments
   */
  emit<K extends keyof EngineEventHandlers>(
    eventType: K,
    ...args: Parameters<EngineEventHandlers[K]>
  ): void;

  /**
   * Cancel all subscriptions to specified event
   * @param eventType Event type
   */
  clearEvent(eventType: keyof EngineEventHandlers): void;

  /**
   * Cancel all subscriptions to all events
   */
  clearAllEvents(): void;
}
