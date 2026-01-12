/**
 * Enumeration of possible ReactiveGraphEngine states
 */
export enum EngineState {
  /**
   * Initial state after engine instance creation.
   * In this state engine is configured but doesn't perform updates.
   */
  INITIALIZED = 'initialized',

  /**
   * Engine is active and performing computations.
   * In this state all subscriptions are active.
   */
  RUNNING = 'running',

  /**
   * Engine is paused, subscriptions inactive but graph structure preserved.
   * Can be resumed by calling resume() method.
   */
  PAUSED = 'paused',

  /**
   * Intermediate state during shutdown.
   * Used for calling hooks before complete destruction.
   */
  STOPPING = 'stopping',

  /**
   * Engine is destroyed, resources released.
   * Cannot be used after transitioning to this state.
   */
  DESTROYED = 'destroyed',
}
