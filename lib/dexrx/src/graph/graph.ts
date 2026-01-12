import type {
  GraphDefinition,
  GraphOperator,
  NodeDefinition,
  SubscriptionHandler,
  UpdateGraphOptions,
} from './operator-types';
import type { INodeDefinition } from '../types/node-definition';
import type { IGraphDefinition } from '../types/graph-definition';
import type { NodeCategory } from '../types/node-plugin';
import { ReactiveGraphEngine, INIT_NODE_EXEC } from '../engine';
import { NodeRegistry } from '../engine';
import type { IEngineOptions } from '../types/engine-options';
import { EngineExecutionMode, DataNodesExecutionMode } from '../types/engine-options';
import type { ICacheProvider, CacheStats } from '../types/cache-types';
import type { EngineStateSnapshot } from '../types/engine-state-snapshot';
import type { EngineStats } from '../types/engine-stats';
import type { EngineEventHandlers, UnsubscribeFn } from '../types/engine-hooks';
import { EngineEventType } from '../types/engine-hooks';
import { EngineState } from '../types/engine-state';
import { Observable } from 'rxjs';

/**
 * Long-running graph type with updateGraph() method
 * Returned by run() method to enable graph updates
 *
 * @template T - Type of result
 */
export interface LongRunningGraph<T = unknown> extends ExecutableGraph<T> {
  /**
   * Updates graph with new nodes from formula block
   * Only available for long-running graphs (started via run())
   * Use when graph structure changes (nodes added/removed, dependencies change)
   */
  updateGraph(newNodes: INodeDefinition[], options?: UpdateGraphOptions): void;

  /**
   * Updates a single node's config/data without recreating the graph
   * Only available for long-running graphs (started via run())
   * Use when only node config/data changes (e.g., webhook data, updated values)
   * Preserves node's Subject and automatically triggers recalculation of dependent nodes
   */
  updateNode(nodeId: string, nodeDef: INodeDefinition): void;

  /**
   * Pause graph execution
   * Only available for long-running graphs
   */
  pause(): void;

  /**
   * Resume paused graph execution
   * Only available for long-running graphs
   */
  resume(): void;

  /**
   * Stop graph execution
   * Only available for long-running graphs
   */
  stop(): void;
}

/**
 * Creates a new graph from operators
 *
 * @example
 * ```typescript
 * const graph = createGraph(
 *   withNodesConfig({
 *     nodesPlugins: [sourcePlugin, addPlugin],
 *     nodes: [
 *       { id: 'a', type: 'source', config: { value: 10 } },
 *       { id: 'b', type: 'source', config: { value: 20 } },
 *       { id: 'sum', type: 'add', inputs: ['a', 'b'], config: { isSubscribed: true } }
 *     ]
 *   })
 * );
 *
 * // For one-shot computation (Lambda/serverless)
 * await graph.execute();
 * const result = graph.exportState();
 *
 * // For long-running graph (webhooks, polling)
 * const longRunning = graph.run(); // Graph starts and keeps running, subscriptions emit results
 * ```
 */
export function createGraph<T = unknown>(
  ...operators: readonly GraphOperator[]
): ExecutableGraph<T> {
  // Start with empty graph
  let graph: GraphDefinition = {
    nodes: new Map(),
    edges: new Map(),
    context: {},
    providers: {},
    plugins: undefined,
    runtimeContextFactory: undefined,
  };

  // Apply all operators sequentially
  for (const operator of operators) {
    graph = operator(graph);
  }

  return new ExecutableGraph<T>(graph);
}

/**
 * Executable graph that can be run
 * Converts Build API graph to graph engine format and executes it
 *
 * @template T - Type of result (used in fromState<T> static method for type inference)
 */
export class ExecutableGraph<T = unknown> {
  private engine: ReactiveGraphEngine | null = null;
  private isDestroyed = false;
  private isRunning = false;

  /**
   * Check if graph has been destroyed
   */
  public get destroyed(): boolean {
    return this.isDestroyed;
  }
  private readonly activeSubscriptions: Map<string, { unsubscribe: () => void }> = new Map();
  private graph: GraphDefinition;
  private _isLongRunning = false; // Flag to track if graph was started via run()

  constructor(graph: GraphDefinition) {
    this.graph = graph;
  }

  /**
   * Execute graph and wait for stabilization (single-shot mode)
   *
   * This method creates the engine, starts execution, and waits for the graph to stabilize.
   * Use this for one-shot computations like AWS Lambda functions.
   *
   * @param options - Execution options
   * @returns Promise that resolves when graph is stabilized
   *
   * @example
   * ```typescript
   * await graph.execute({
   *   timeout: 60000,
   *   onDone: async (stats, reason) => {
   *     console.log('Graph done:', reason);
   *   }
   * });
   * const result = graph.exportState();
   * ```
   */
  async execute(options?: {
    timeout?: number;
    checkInterval?: number;
    onDone?: (
      stats: EngineStats,
      reason: 'stabilized' | 'skip_computation'
    ) => void | Promise<void>;
  }): Promise<void> {
    if (this.isDestroyed) {
      throw new Error('Graph has been destroyed');
    }

    // Ensure engine is created and started
    if (!this.engine) {
      this.engine = this.createGraphEngine();
      const engineGraph = this.convertToGraphEngineFormat();
      this.engine.importGraph(engineGraph);
    }
    if (!this.isRunning) {
      this.startInternal();
    }

    // Wait for stabilization (reuse existing logic)
    return this.waitForStabilizationInternal(options);
  }

  /**
   * Runs the graph in long-running mode
   * Starts the graph and leaves it running to react to triggers (webhooks, polling, etc.)
   * Subscriptions are automatically applied - subscribed nodes will emit results through subscription handlers
   *
   * Use this for:
   * - Long-running graphs that react to external triggers (webhooks, polling)
   * - Scenarios where data nodes poll or receive webhooks
   * - Continuous computation that needs to stay alive
   *
   * The graph will keep running until explicitly stopped with stop() or destroy()
   * Subscription handlers (from withNodesConfig) will be called whenever subscribed nodes emit new values
   *
   * **Note:** This method is synchronous and returns immediately. The graph continues running in the background.
   * Works in both browser and Node.js environments.
   *
   * @param options - Run options (optional initial state)
   * @returns LongRunningGraph instance with updateGraph(), pause(), resume(), stop() methods enabled
   *
   * @example
   * ```typescript
   * const graph = createGraph(
   *   withNodesConfig({
   *     nodesPlugins: [fetchPlugin, mathPlugin],
   *     nodes: [
   *       { id: 'fetch1', type: 'fetch', config: { url: '...', poll: 60 } },
   *       { id: 'math1', type: 'math', inputs: ['fetch1'], config: { isSubscribed: true } }
   *     ],
   *     subscriptions: {
   *       'math1': (value, nodeId, nodeType) => {
   *         console.log(`Node ${nodeId} emitted:`, value);
   *       }
   *     }
   *   })
   * );
   *
   * // Start fresh
   * const longRunning = graph.run();
   *
   * // Start with saved state
   * const longRunning = graph.run({ initialState: savedState });
   * ```
   */
  run(options?: { initialState?: EngineStateSnapshot }): LongRunningGraph<T> {
    if (this.isDestroyed) {
      throw new Error('Graph has been destroyed and cannot be run again');
    }

    // Create engine if needed
    if (!this.engine) {
      this.engine = this.createGraphEngine();
      const engineGraph = this.convertToGraphEngineFormat();
      this.engine.importGraph(engineGraph);
    }

    // Import initial state if provided (synchronously via engine.importState)
    // Note: engine.importState() is async, but we'll handle it by importing before starting
    // For now, we'll import state and start - if import fails, graph will start fresh
    if (options?.initialState) {
      // Import state - fire and forget (will complete asynchronously)
      // Graph will start immediately, state will be imported in background
      // This is acceptable because engine.importState() can handle partial imports
      this.engine.importState(options.initialState, { preserveOptions: true }).catch(() => {
        // If import fails, continue with fresh start
        // Graph will start without state
      });
    }

    // Start the graph (creates engine if needed, imports graph, starts engine, applies subscriptions)
    this.startInternal();

    // Mark as long-running graph (enables updateGraph(), pause(), resume(), stop() methods)
    this._isLongRunning = true;

    // Graph is now running and will continue to run
    // Subscriptions are active and will emit results through subscription handlers
    // Data nodes can poll or receive webhooks, triggering recalculation
    // Subscribed nodes will emit through their subscription handlers

    // Return this as LongRunningGraph to enable updateGraph() and lifecycle methods
    return this as LongRunningGraph<T>;
  }

  /**
   * Creates ReactiveGraphEngine with necessary plugins registered
   */
  private createGraphEngine(): ReactiveGraphEngine {
    if (this.engine) {
      return this.engine;
    }

    const registry = new NodeRegistry();

    // Register external plugins if provided
    if (this.graph.plugins) {
      for (const [, plugin] of this.graph.plugins) {
        registry.register(plugin);
      }
    }

    // Register a plugin for each node with its computeFunction
    // We use nodeId as the plugin type to ensure uniqueness
    for (const node of this.graph.nodes.values()) {
      if (node.computeFunction) {
        // Create a unique plugin type for each node
        const pluginType = `build-api-${node.id}`;

        // Try to get category from original plugin, default to 'operational' for computeFunction nodes
        let category: NodeCategory = 'operational';
        if (this.graph.plugins && node.type) {
          const originalPlugin = this.graph.plugins.get(node.type);
          if (originalPlugin) {
            category = originalPlugin.category;
          }
        }

        registry.register({
          type: pluginType,
          category,
          compute: (_config: unknown, inputs: unknown[]) => {
            // Get execution context
            const context = {
              ...this.graph.context,
              logger: this.graph.providers.logger,
            };

            // Call the node's compute function
            // computeFunction is guaranteed to exist due to the if check above
            if (!node.computeFunction) {
              throw new Error(`Compute function not found for node ${node.id}`);
            }
            return node.computeFunction(node.config, inputs, context);
          },
        });
      }
    }

    // Create engine options with providers
    // Convert Build API cache provider to graph engine ICacheProvider if needed
    const engineCacheProvider: ICacheProvider | undefined = this.graph.providers.cache
      ? new BuildApiCacheAdapter(this.graph.providers.cache)
      : undefined;

    // Determine execution mode: use explicit executionMode from context, or infer from parallelOptions
    const executionMode =
      this.graph.context.executionMode ??
      (this.graph.context.parallelOptions
        ? EngineExecutionMode.PARALLEL
        : EngineExecutionMode.SERIAL);

    const options: IEngineOptions = {
      autoStart: false, // We'll start manually
      logger: this.graph.providers.logger,
      executionMode: executionMode,
      parallelOptions: this.graph.context.parallelOptions,
      dataNodesExecutionMode: this.graph.context.dataNodesExecutionMode,
      debounceTime: this.graph.context.debounceTime,
      distinctValues: this.graph.context.distinctValues,
      throttleTime: this.graph.context.throttleTime,
      enableCancelableCompute: this.graph.context.enableCancelableCompute,
      maxDepth: this.graph.context.maxDepth,
      silentErrors: this.graph.context.silentErrors,
      sanitizeInput: this.graph.context.sanitizeInput,
      cacheOptions: engineCacheProvider
        ? {
            enabled: true,
            provider: engineCacheProvider,
          }
        : undefined,
    };

    this.engine = new ReactiveGraphEngine(registry, options);
    return this.engine;
  }

  /**
   * Converts Build API graph to graph engine IGraphDefinition format
   */
  private convertToGraphEngineFormat(): IGraphDefinition {
    const nodes: INodeDefinition[] = [];

    for (const node of this.graph.nodes.values()) {
      // Create graph engine node definition
      // Use unique plugin type for each node (registered in createGraphEngine)
      const pluginType = node.computeFunction ? `build-api-${node.id}` : node.type;

      // Add runtime context if factory is provided
      // Factory receives (nodeId, nodeType, graph) - graph provides access to context.dataNodesExecutionMode
      let config = { ...node.config };
      if (this.graph.runtimeContextFactory) {
        const runtimeContext = this.graph.runtimeContextFactory(node.id, node.type, this.graph);
        config = {
          ...config,
          __runtime: runtimeContext,
        };
      }

      const engineNode: INodeDefinition = {
        id: node.id,
        type: pluginType,
        inputs: node.inputs.length > 0 ? [...node.inputs] : undefined,
        config,
      };

      nodes.push(engineNode);
    }

    return {
      nodes,
      metadata: {
        version: '2.0.0',
        description: 'Build API graph',
      },
    };
  }

  /**
   * Gets Observable for a specific node
   * Useful for reactive subscriptions
   */
  observeNode(nodeId: string): Observable<unknown> | undefined {
    // If engine is already created, use it
    if (this.engine) {
      // Make sure engine is started
      if (!this.isRunning) {
        this.engine.start();
        this.isRunning = true;
      }
      return this.engine.observeNode(nodeId);
    }

    // Otherwise create a new engine
    const engine = this.createGraphEngine();
    const engineGraph = this.convertToGraphEngineFormat();

    // Import graph if not already imported
    try {
      engine.importGraph(engineGraph, { conflictStrategy: 'skip' });
    } catch {
      // Graph might already be imported
    }

    engine.start();
    this.engine = engine;
    this.isRunning = true;
    return engine.observeNode(nodeId);
  }

  /**
   * Internal method to start graph execution
   * Used by execute() and run()
   *
   * @private
   */
  private startInternal(): void {
    if (this.isDestroyed) {
      throw new Error('Graph has been destroyed');
    }
    if (this.isRunning) {
      return;
    }

    // If engine is already created, check its state
    // If engine is destroyed or stopping, recreate it
    if (this.engine) {
      const engineState = this.engine.getState();
      if (engineState === EngineState.DESTROYED || engineState === EngineState.STOPPING) {
        // Engine is destroyed, need to recreate
        this.engine = null;
      }
    }

    // If engine is not created or was destroyed, create a new one
    if (!this.engine) {
      this.engine = this.createGraphEngine();
      const engineGraph = this.convertToGraphEngineFormat();
      this.engine.importGraph(engineGraph);
    }

    this.engine.start();
    this.isRunning = true;

    // Apply subscription handlers if any
    this.applySubscriptions();
  }

  /**
   * Applies subscription handlers to subscribed nodes
   * Called automatically in start()
   * Dynamically processes subscription config for all subscribed nodes
   */
  private applySubscriptions(): void {
    if (!this.engine || !this.graph.subscriptionConfig) {
      return;
    }

    // Get all subscribed nodes
    const subscribedNodes = Array.from(this.graph.nodes.values()).filter(
      node => node.config.isSubscribed === true
    );

    if (subscribedNodes.length === 0) {
      return;
    }

    const config = this.graph.subscriptionConfig;
    const handlers = new Map<string, SubscriptionHandler>();

    // Process config based on type
    if (typeof config === 'function') {
      // Check if it's a handler function (nodeId, value, nodeType) or generator (subscribedNodes) => Map
      if (config.length === 3) {
        // Handler function: (nodeId, value, nodeType) => void
        // Apply to all subscribed nodes
        for (const node of subscribedNodes) {
          handlers.set(node.id, (value, nodeId, nodeType) => {
            (config as (nodeId: string, value: unknown, nodeType: string) => void)(
              nodeId,
              value,
              nodeType
            );
          });
        }
      } else {
        // Generator function: (subscribedNodes) => Map<string, handler>
        const generatedHandlers = (
          config as (subscribedNodes: readonly NodeDefinition[]) => Map<string, SubscriptionHandler>
        )(subscribedNodes);
        if (generatedHandlers && generatedHandlers instanceof Map) {
          for (const [nodeId, handler] of generatedHandlers.entries()) {
            handlers.set(nodeId, handler);
          }
        }
      }
    } else {
      // Record: { nodeId: handler } - already processed in withSubscription
      if (this.graph.subscriptionHandlers) {
        for (const [nodeId, handler] of this.graph.subscriptionHandlers.entries()) {
          handlers.set(nodeId, handler);
        }
      }
    }

    // Subscribe to nodes that have handlers
    for (const node of subscribedNodes) {
      const handler = handlers.get(node.id);
      if (!handler) {
        continue;
      }

      const observable = this.engine.observeNode(node.id);
      if (observable) {
        const subscription = observable.subscribe({
          next: (value: unknown) => {
            try {
              handler(value, node.id, node.type);
            } catch (error) {
              console.error(`Error in subscribed node ${node.id}:`, error);
            }
          },
          error: (error: unknown) => {
            console.error(`Error in subscribed node ${node.id}:`, error);
          },
        });

        // Store subscription for cleanup
        this.activeSubscriptions.set(node.id, subscription);
      }
    }
  }

  /**
   * Stops graph execution (without destroying)
   * Unsubscribes from all active subscriptions
   */
  stop(): void {
    // Unsubscribe from all active subscriptions
    for (const subscription of this.activeSubscriptions.values()) {
      if (subscription && typeof subscription.unsubscribe === 'function') {
        subscription.unsubscribe();
      }
    }
    this.activeSubscriptions.clear();

    if (this.engine && this.isRunning) {
      this.engine.stop();
      this.isRunning = false;
    }
  }

  /**
   * Pauses graph execution
   */
  pause(): void {
    if (this.engine && this.isRunning) {
      this.engine.pause();
    }
  }

  /**
   * Resumes graph execution
   */
  resume(): void {
    if (this.engine && this.isRunning) {
      this.engine.resume();
    }
  }

  /**
   * Exports engine state for persistence
   * Uses existing engine if it was already created (e.g., in start()),
   * otherwise creates a new one for export
   */
  exportState(includeMetadata = true): EngineStateSnapshot {
    // If engine is already created (e.g., in start()), use it
    // This is important for stateless serverless - within a single Lambda invocation
    // we should not create engine twice
    if (this.engine) {
      return this.engine.exportState(includeMetadata);
    }

    // Otherwise create a new engine only for export
    const engine = this.createGraphEngine();
    const engineGraph = this.convertToGraphEngineFormat();
    engine.importGraph(engineGraph);
    engine.start();
    return engine.exportState(includeMetadata);
  }

  /**
   * Imports engine state and restores graph
   * IMPORTANT: engine.importState() already adds nodes, so we don't need to import graph first
   * Automatically applies runtimeContextFactory to update __runtime in node configs
   *
   * For long-running graphs: pauses graph, imports state, then resumes
   * For single-shot graphs: imports state (call before execute())
   */
  async importState(
    state: EngineStateSnapshot,
    options?: { preserveOptions?: boolean; validateTypes?: boolean }
  ): Promise<void> {
    // For long-running graphs: pause, import, resume
    if (this._isLongRunning && this.isRunning) {
      const wasRunning = this.isRunning;
      if (wasRunning && this.engine) {
        this.engine.pause();
      }

      // Import state
      await this.importStateInternal(state, options);

      // Resume if was running
      if (wasRunning && this.engine) {
        this.engine.resume();
      }
      return;
    }

    // For single-shot: just import
    await this.importStateInternal(state, options);
  }

  /**
   * Internal method to import state
   * @private
   */
  private async importStateInternal(
    state: EngineStateSnapshot,
    options?: { preserveOptions?: boolean; validateTypes?: boolean }
  ): Promise<void> {
    // Apply runtimeContextFactory to update __runtime in node configs before import
    // This ensures that __runtime is up-to-date (e.g., new messageId, triggeredNodeId)
    let finalState = state;
    if (this.graph.runtimeContextFactory) {
      const updatedNodes: Record<string, (typeof state.nodes)[string]> = {};
      for (const [nodeId, nodeState] of Object.entries(state.nodes)) {
        const runtimeContext = this.graph.runtimeContextFactory(nodeId, nodeState.type, this.graph);
        updatedNodes[nodeId] = {
          ...nodeState,
          config: {
            ...nodeState.config,
            __runtime: runtimeContext,
          },
        };
      }
      finalState = {
        ...state,
        nodes: updatedNodes,
      };
    }

    const engine = this.createGraphEngine();
    // DO NOT import graph - engine.importState() will add nodes from state itself
    // If we import graph first, there will be a conflict when calling start()
    await engine.importState(finalState, options);
    // Save engine for further use
    this.engine = engine;
    // Update graph definition from imported state
    this.updateGraphFromState(state);
  }

  /**
   * Creates graph from saved state
   */
  static fromState<T>(state: EngineStateSnapshot): ExecutableGraph<T> {
    // Convert state to Build API graph definition
    const graph = convertStateToGraphDefinition(state);
    return new ExecutableGraph<T>(graph);
  }

  /**
   * Subscribes to engine events
   */
  on<K extends keyof EngineEventHandlers>(
    eventType: K,
    handler: EngineEventHandlers[K]
  ): UnsubscribeFn {
    // If engine is already created, use it
    if (this.engine) {
      return this.engine.on(eventType, handler);
    }

    // Otherwise create a new engine for event subscription
    // But this should not happen - events are only needed for a running graph
    const engine = this.createGraphEngine();
    const engineGraph = this.convertToGraphEngineFormat();
    engine.importGraph(engineGraph);
    this.engine = engine;
    return engine.on(eventType, handler);
  }

  /**
   * Gets engine statistics
   * Uses existing engine if it was already created, otherwise creates a new one
   */
  getStats(): EngineStats {
    // If engine is already created, use it
    if (this.engine) {
      return this.engine.getStats();
    }

    // Otherwise create a new engine only for getting statistics
    const engine = this.createGraphEngine();
    const engineGraph = this.convertToGraphEngineFormat();
    engine.importGraph(engineGraph);
    engine.start();
    return engine.getStats();
  }

  /**
   * Gets current engine state
   */
  getState(): EngineState {
    if (this.isDestroyed) {
      return EngineState.DESTROYED;
    }
    if (!this.engine) {
      return EngineState.INITIALIZED;
    }
    return this.engine.getState();
  }

  /**
   * Gets active tasks count (for monitoring)
   */
  getActiveTasks(): number {
    return this.getStats().activeTasks;
  }

  /**
   * Gets Observables for all subscribed nodes
   */
  observeSubscribedNodes(): Map<string, Observable<unknown>> {
    // If engine is already created, use it
    if (this.engine) {
      // Make sure engine is started
      if (!this.isRunning) {
        this.engine.start();
        this.isRunning = true;
      }
    } else {
      // Otherwise create a new engine
      const engine = this.createGraphEngine();
      const engineGraph = this.convertToGraphEngineFormat();
      engine.importGraph(engineGraph);
      engine.start();
      this.engine = engine;
      this.isRunning = true;
    }

    const observables = new Map<string, Observable<unknown>>();
    const subscribedNodes = Array.from(this.graph.nodes.values()).filter(
      node => node.config.isSubscribed
    );

    if (!this.engine) {
      return observables;
    }

    for (const node of subscribedNodes) {
      const observable = this.engine.observeNode(node.id);
      if (observable) {
        observables.set(node.id, observable);
      }
    }

    return observables;
  }

  /**
   * Internal method to wait for graph stabilization
   * Used by execute()
   *
   * @private
   */
  private async waitForStabilizationInternal(options?: {
    timeout?: number;
    checkInterval?: number;
    onDone?: (
      stats: EngineStats,
      reason: 'stabilized' | 'skip_computation'
    ) => void | Promise<void>;
  }): Promise<void> {
    if (this.isDestroyed) {
      throw new Error('Graph has been destroyed');
    }

    const timeout = options?.timeout ?? 180000; // 3 minutes default
    const checkInterval = options?.checkInterval ?? 500; // 500ms default

    // Ensure engine is created and started
    if (!this.engine) {
      this.engine = this.createGraphEngine();
      const engineGraph = this.convertToGraphEngineFormat();
      this.engine.importGraph(engineGraph);
    }
    if (!this.isRunning) {
      this.engine.start();
      this.isRunning = true;
    }

    // Get dataNodesExecutionMode from graph context (automatically set by withEngineOptions)
    const dataNodesExecutionMode =
      this.graph.context.dataNodesExecutionMode ?? DataNodesExecutionMode.SYNC_EXEC_MODE;

    return new Promise((resolve, reject) => {
      const nodeObservables: { [nodeId: string]: { unsubscribe: () => void } } = {};
      const currentValues: { [nodeId: string]: unknown } = {};
      let skipComputationReceived = false;
      let stabilityCheck: ReturnType<typeof setInterval> | null = null;

      // Get subscribed nodes from graph definition
      const subscribedNodes = Array.from(this.graph.nodes.values()).filter(
        node => node.config.isSubscribed
      );

      // If we have subscribed nodes, use them for stabilization tracking
      // Otherwise, we'll use activeTasks count (allows execute() to work without subscriptions)
      const useSubscribedNodesForStabilization = subscribedNodes.length > 0;

      // Subscribe to NODE_SKIP_COMPUTATION hook with automatic mode handling
      const skipHookUnsubscribe = this.on(
        EngineEventType.NODE_SKIP_COMPUTATION,
        (_nodeId: string) => {
          if (dataNodesExecutionMode === DataNodesExecutionMode.ASYNC_EXEC_MODE) {
            // ASYNC_EXEC_MODE: complete stabilization immediately on SKIP_COMPUTATION
            // Same as imperative approach: engine.pause() stops all subscriptions,
            // so we don't wait for operational nodes (math, etc.) or subscribed nodes to complete
            // This is the expected behavior for ASYNC mode - only triggered data node executes
            skipComputationReceived = true;

            // Cleanup subscriptions
            Object.values(nodeObservables).forEach(subscription => {
              if (subscription && typeof subscription.unsubscribe === 'function') {
                subscription.unsubscribe();
              }
            });

            // Unsubscribe from hook
            skipHookUnsubscribe();

            // Clear interval
            if (stabilityCheck) {
              clearInterval(stabilityCheck);
              stabilityCheck = null;
            }

            // Call onDone callback if provided
            if (options?.onDone) {
              const stats = this.getStats();
              Promise.resolve(options.onDone(stats, 'skip_computation'))
                .then(() => resolve())
                .catch(reject);
            } else {
              resolve();
            }
          }
          // SYNC_EXEC_MODE: ignore SKIP_COMPUTATION, continue waiting for ALL subscribed nodes
          // In SYNC mode, ALL data nodes execute regardless of trigger, so SKIP from one node
          // doesn't mean we're done - we wait for ALL subscribed nodes to stabilize
          // (activeTasks === 0 AND all subscribed nodes have values)
        }
      );

      // Subscribe to all subscribed nodes (without filtering INIT_NODE_EXEC)
      // Same logic as in imperative approach - all values go to currentValues
      if (!this.engine) {
        reject(new Error('Engine not initialized'));
        return;
      }

      // Subscribe to subscribed nodes if any (for stabilization tracking)
      if (useSubscribedNodesForStabilization) {
        for (const node of subscribedNodes) {
          const observable = this.engine.observeNode(node.id);
          if (observable) {
            nodeObservables[node.id] = observable.subscribe({
              next: (value: unknown) => {
                currentValues[node.id] = value;
              },
              error: (error: unknown) => {
                // Log error but don't break stabilization
                console.error(`Error in subscribed node ${node.id}:`, error);
              },
            });
          }
        }
      }

      // Stability check interval (same logic as imperative approach)
      stabilityCheck = setInterval(() => {
        try {
          // If already received SKIP_COMPUTATION hook, don't check stability
          if (skipComputationReceived) {
            return;
          }

          // Get current stats
          const stats = this.getStats();
          const hasActiveTasks = stats.activeTasks > 0;

          // Stabilization condition: no active tasks (primary condition)
          // This is the main indicator that graph has completed all computations
          // If we have subscribed nodes, we can also verify they have values (additional check)
          let isStabilized = !hasActiveTasks;

          if (useSubscribedNodesForStabilization && isStabilized) {
            // Additional check: verify all subscribed nodes have values
            // This ensures we don't resolve too early if subscribed nodes haven't computed yet
            // Same validation as imperative approach: value !== undefined && value !== INIT_NODE_EXEC
            // In SYNC_EXEC_MODE: wait for ALL subscribed nodes (even if some returned SKIP_NODE_EXEC)
            // In ASYNC_EXEC_MODE: if SKIP_COMPUTATION hook received, we already resolved above
            const allSubscribedNodesHaveValues = subscribedNodes.every(node => {
              const value = currentValues[node.id];
              return value !== undefined && value !== INIT_NODE_EXEC;
            });

            // Only consider stabilized if both conditions are met
            isStabilized = allSubscribedNodesHaveValues;
          }

          if (isStabilized) {
            // Graph is stabilized
            if (stabilityCheck) {
              clearInterval(stabilityCheck);
              stabilityCheck = null;
            }

            // Cleanup subscriptions
            Object.values(nodeObservables).forEach(subscription => {
              if (subscription && typeof subscription.unsubscribe === 'function') {
                subscription.unsubscribe();
              }
            });

            // Unsubscribe from hook
            skipHookUnsubscribe();

            // Call onDone callback if provided
            if (options?.onDone) {
              Promise.resolve(options.onDone(stats, 'stabilized'))
                .then(() => resolve())
                .catch(reject);
            } else {
              resolve();
            }
          }
        } catch (error) {
          // Cleanup on error
          if (stabilityCheck) {
            clearInterval(stabilityCheck);
            stabilityCheck = null;
          }
          Object.values(nodeObservables).forEach(subscription => {
            if (subscription && typeof subscription.unsubscribe === 'function') {
              subscription.unsubscribe();
            }
          });
          skipHookUnsubscribe();
          reject(error);
        }
      }, checkInterval);

      // Timeout safety
      setTimeout(() => {
        if (stabilityCheck) {
          clearInterval(stabilityCheck);
          stabilityCheck = null;
        }
        Object.values(nodeObservables).forEach(subscription => {
          if (subscription && typeof subscription.unsubscribe === 'function') {
            subscription.unsubscribe();
          }
        });
        skipHookUnsubscribe();
        reject(new Error(`Graph stabilization timeout after ${timeout}ms`));
      }, timeout);
    });
  }

  /**
   * Saves graph state using registered persistence provider
   * @param key - State key identifier
   * @param options - Save options (TTL in seconds)
   * @throws Error if persistence provider not registered
   *
   * @example
   * ```typescript
   * const graph = createGraph(
   *   withPersistence(myPersistenceProvider),
   *   withNodes(nodes)
   * );
   *
   * await graph.saveState('work-123', { ttl: 3600 });
   * ```
   */
  async saveState(key: string, options?: { ttl?: number }): Promise<void> {
    if (!this.graph.providers.persistence) {
      throw new Error(
        'Persistence provider not registered. Use withPersistence() operator to register a provider.'
      );
    }

    const state = this.exportState(true);
    await this.graph.providers.persistence.saveState(key, state, options);
  }

  /**
   * Loads graph state using registered persistence provider
   * @param key - State key identifier
   * @returns Loaded state or null if not found
   * @throws Error if persistence provider not registered
   *
   * @example
   * ```typescript
   * const graph = createGraph(
   *   withPersistence(myPersistenceProvider),
   *   withNodes(nodes)
   * );
   *
   * const state = await graph.loadState<EngineStateSnapshot>('work-123');
   * if (state) {
   *   await graph.importState(state);
   * }
   * ```
   */
  async loadState<T = EngineStateSnapshot>(key: string): Promise<T | null> {
    if (!this.graph.providers.persistence) {
      throw new Error(
        'Persistence provider not registered. Use withPersistence() operator to register a provider.'
      );
    }

    return await this.graph.providers.persistence.loadState<T>(key);
  }

  /**
   * Deletes graph state using registered persistence provider
   * @param key - State key identifier
   * @throws Error if persistence provider not registered
   *
   * @example
   * ```typescript
   * await graph.deleteState('work-123');
   * ```
   */
  async deleteState(key: string): Promise<void> {
    if (!this.graph.providers.persistence) {
      throw new Error(
        'Persistence provider not registered. Use withPersistence() operator to register a provider.'
      );
    }

    await this.graph.providers.persistence.deleteState(key);
  }

  /**
   * Sends notification to specific connection using registered notification provider
   * @param connectionId - Connection identifier
   * @param data - Notification data
   * @throws Error if notification provider not registered
   *
   * @example
   * ```typescript
   * const graph = createGraph(
   *   withNotifications(myNotificationProvider),
   *   withNodes(nodes)
   * );
   *
   * await graph.notify('conn-123', { type: 'update', data: {...} });
   * ```
   */
  async notify(connectionId: string, data: unknown): Promise<void> {
    if (!this.graph.providers.notifications) {
      throw new Error(
        'Notification provider not registered. Use withNotifications() operator to register a provider.'
      );
    }

    await this.graph.providers.notifications.notify(connectionId, data);
  }

  /**
   * Broadcasts message to topic using registered notification provider
   * @param topic - Topic identifier (e.g., tenantId, channelId)
   * @param data - Broadcast data
   * @throws Error if notification provider not registered
   *
   * @example
   * ```typescript
   * await graph.broadcast('tenant-123', { type: 'batch_update', updates: {...} });
   * ```
   */
  async broadcast(topic: string, data: unknown): Promise<void> {
    if (!this.graph.providers.notifications) {
      throw new Error(
        'Notification provider not registered. Use withNotifications() operator to register a provider.'
      );
    }

    await this.graph.providers.notifications.broadcast(topic, data);
  }

  /**
   * Subscribes connection to topic using registered notification provider
   * @param connectionId - Connection identifier
   * @param topic - Topic identifier
   * @throws Error if notification provider not registered
   *
   * @example
   * ```typescript
   * await graph.subscribe('conn-123', 'tenant-456');
   * ```
   */
  async subscribe(connectionId: string, topic: string): Promise<void> {
    if (!this.graph.providers.notifications) {
      throw new Error(
        'Notification provider not registered. Use withNotifications() operator to register a provider.'
      );
    }

    await this.graph.providers.notifications.subscribe(connectionId, topic);
  }

  /**
   * Unsubscribes connection from topic using registered notification provider
   * @param connectionId - Connection identifier
   * @param topic - Topic identifier
   * @throws Error if notification provider not registered
   *
   * @example
   * ```typescript
   * await graph.unsubscribe('conn-123', 'tenant-456');
   * ```
   */
  async unsubscribe(connectionId: string, topic: string): Promise<void> {
    if (!this.graph.providers.notifications) {
      throw new Error(
        'Notification provider not registered. Use withNotifications() operator to register a provider.'
      );
    }

    await this.graph.providers.notifications.unsubscribe(connectionId, topic);
  }

  /**
   * Updates graph definition from imported state
   * Restores nodes and edges so that waitForStabilization() can find subscribed nodes
   */
  private updateGraphFromState(state: EngineStateSnapshot): void {
    const nodes = new Map<string, NodeDefinition>();
    const edges = new Map<string, readonly string[]>();

    // Convert state nodes to Build API node definitions
    for (const [nodeId, nodeState] of Object.entries(state.nodes)) {
      nodes.set(nodeId, {
        id: nodeState.id,
        type: nodeState.type,
        inputs: nodeState.inputs ?? [],
        config: nodeState.config ?? {},
        // Note: computeFunction is not stored in state, nodes will use plugins from registry
      });

      // Update edges map
      if (nodeState.inputs && nodeState.inputs.length > 0) {
        edges.set(nodeId, nodeState.inputs);
      }
    }

    // Update graph definition with restored nodes and edges
    // Preserve existing context, providers, plugins, and runtimeContextFactory
    this.graph = {
      ...this.graph,
      nodes,
      edges,
    };
  }

  /**
   * Destroys the graph and releases resources
   */
  destroy(): void {
    if (this.engine) {
      this.engine.destroy();
      this.engine = null;
    }
    this.isDestroyed = true;
    this.isRunning = false;
  }

  /**
   * Updates graph with new nodes from formula block
   * **Only available for long-running graphs (started via run())**
   * Stops and destroys old graph, creates new one with same infrastructure (providers, options, plugins)
   *
   * @param newNodes - New node definitions from updated formula block
   * @param options - Update options
   *
   * @throws Error if graph was started via start() instead of run()
   *
   * @example
   * ```typescript
   * // Graph is running in long-running mode
   * const longRunningGraph = graph.run();
   *
   * // Formula updated - backend provides new nodes
   * const newNodes = [
   *   { id: 'fetch1', type: 'fetch', config: { url: 'new-url' } },
   *   { id: 'math1', type: 'math', inputs: ['fetch1'], config: { op: 'AVG' } }
   * ];
   *
   * // Update graph - old graph destroyed, new one created and started
   * longRunningGraph.updateGraph(newNodes, { autoStart: true });
   * ```
   */
  updateGraph(newNodes: INodeDefinition[], options?: UpdateGraphOptions): void {
    // Runtime check: updateGraph() is only available for long-running graphs
    if (!this._isLongRunning) {
      throw new Error(
        'updateGraph() is only available for long-running graphs. Use run() instead of start() to enable graph updates.'
      );
    }
    if (this.isDestroyed) {
      throw new Error('Cannot update destroyed graph');
    }

    // 1. Stop and destroy old engine
    if (this.engine) {
      this.stop(); // Unsubscribes from all subscriptions
      this.engine.destroy();
      this.engine = null;
    }
    this.isRunning = false;

    // 2. Save infrastructure from old graph (providers, context, plugins, runtimeContextFactory)
    const savedInfrastructure = {
      providers: { ...this.graph.providers },
      context: { ...this.graph.context },
      plugins: this.graph.plugins ? new Map(this.graph.plugins) : undefined,
      runtimeContextFactory: this.graph.runtimeContextFactory,
      subscriptionConfig: this.graph.subscriptionConfig,
      subscriptionHandlers: this.graph.subscriptionHandlers
        ? new Map(this.graph.subscriptionHandlers)
        : undefined,
    };

    // 3. Create new nodes and edges maps
    const newNodesMap = new Map<string, NodeDefinition>();
    const newEdgesMap = new Map<string, readonly string[]>();

    // 4. Add new nodes using topological sort (same logic as withNodes)
    const sortedNodes = this.topologicalSort(newNodes);

    for (const nodeDef of sortedNodes) {
      // Validate that all input nodes exist
      if (nodeDef.inputs) {
        for (const inputId of nodeDef.inputs) {
          if (!newNodesMap.has(inputId)) {
            throw new Error(`Input node '${inputId}' not found for node '${nodeDef.id}'`);
          }
        }
      }

      // Create Build API node definition
      const node: NodeDefinition = {
        id: nodeDef.id,
        type: nodeDef.type,
        inputs: nodeDef.inputs ? [...nodeDef.inputs] : [],
        config: { ...nodeDef.config },
      };

      // Update edges map
      if (nodeDef.inputs && nodeDef.inputs.length > 0) {
        newEdgesMap.set(nodeDef.id, nodeDef.inputs);
      }

      // Add node to graph
      newNodesMap.set(nodeDef.id, node);
    }

    // 5. Create new GraphDefinition with new nodes but same infrastructure
    // For long-running graphs, preserve subscriptions by default (unless explicitly disabled)
    const shouldPreserveSubscriptions = options?.preserveSubscriptions !== false;
    const newGraph: GraphDefinition = {
      nodes: newNodesMap,
      edges: newEdgesMap,
      context: savedInfrastructure.context,
      providers: savedInfrastructure.providers,
      plugins: savedInfrastructure.plugins,
      runtimeContextFactory: savedInfrastructure.runtimeContextFactory,
      subscriptionConfig: shouldPreserveSubscriptions
        ? savedInfrastructure.subscriptionConfig
        : undefined,
      subscriptionHandlers: shouldPreserveSubscriptions
        ? savedInfrastructure.subscriptionHandlers
        : undefined,
    };

    // 6. Update this.graph with new definition
    this.graph = newGraph;

    // 7. Optionally start new graph
    if (options?.autoStart) {
      this.startInternal();
      // Preserve long-running flag after update
      this._isLongRunning = true;
    }
  }

  /**
   * Updates a single node's config/data without recreating the graph
   * Preserves node's Subject and automatically triggers recalculation of dependent nodes
   *
   * @param nodeId - ID of the node to update
   * @param nodeDef - New node definition (must have same id and type)
   *
   * @throws Error if graph is not in long-running mode
   * @throws Error if engine is not initialized
   * @throws Error if node doesn't exist
   *
   * @example
   * ```typescript
   * // Update webhook node with new data
   * longRunningGraph.updateNode('webhook1', {
   *   id: 'webhook1',
   *   type: 'webhook',
   *   config: { data: newWebhookData, isSubscribed: true }
   * });
   * // Dependent nodes automatically recalculate!
   * ```
   */
  updateNode(nodeId: string, nodeDef: INodeDefinition): void {
    // Runtime check: updateNode() is only available for long-running graphs
    if (!this._isLongRunning) {
      throw new Error(
        'updateNode() is only available for long-running graphs. Use run() instead of execute() to enable node updates.'
      );
    }
    if (this.isDestroyed) {
      throw new Error('Cannot update node in destroyed graph');
    }
    if (!this.engine) {
      throw new Error('Engine not initialized. Call run() first.');
    }

    // Validate nodeId matches
    if (nodeDef.id !== nodeId) {
      throw new Error(`Node ID mismatch: expected '${nodeId}', got '${nodeDef.id}'`);
    }

    // Check if node exists in graph
    const existingNode = this.graph.nodes.get(nodeId);
    if (!existingNode) {
      throw new Error(`Node '${nodeId}' not found in graph`);
    }

    // Validate node type matches (can't change type of existing node)
    if (nodeDef.type !== existingNode.type) {
      throw new Error(
        `Cannot change node type: node '${nodeId}' has type '${existingNode.type}', cannot change to '${nodeDef.type}'. Use updateGraph() to change node structure.`
      );
    }

    // Prepare config with runtime context if factory is provided
    let config = { ...nodeDef.config };
    if (this.graph.runtimeContextFactory) {
      const runtimeContext = this.graph.runtimeContextFactory(nodeId, nodeDef.type, this.graph);
      config = {
        ...config,
        __runtime: runtimeContext,
      };
    }

    // Convert to engine format
    const pluginType = existingNode.computeFunction ? `build-api-${nodeId}` : nodeDef.type;
    const engineNodeDef: INodeDefinition = {
      id: nodeId,
      type: pluginType,
      inputs: nodeDef.inputs && nodeDef.inputs.length > 0 ? [...nodeDef.inputs] : undefined,
      config,
    };

    // Update node in engine (preserves Subject, recreates wrapper and subscriptions)
    this.engine.updateNode(nodeId, engineNodeDef);

    // Update node in graph.nodes for consistency (create new Map since it's ReadonlyMap)
    const updatedNode: NodeDefinition = {
      ...existingNode,
      inputs: nodeDef.inputs ? [...nodeDef.inputs] : [],
      config: { ...nodeDef.config },
    };
    const newNodes = new Map(this.graph.nodes);
    newNodes.set(nodeId, updatedNode);

    // Update edges if inputs changed (create new Map since it's ReadonlyMap)
    const newEdges = new Map(this.graph.edges);
    if (nodeDef.inputs && nodeDef.inputs.length > 0) {
      newEdges.set(nodeId, nodeDef.inputs);
    } else {
      newEdges.delete(nodeId);
    }

    // Update graph with new nodes and edges
    this.graph = {
      ...this.graph,
      nodes: newNodes,
      edges: newEdges,
    };
  }

  /**
   * Topological sort for INodeDefinition array
   * Ensures nodes without inputs are added first, then nodes with inputs
   * @private
   */
  private topologicalSort(nodes: INodeDefinition[]): INodeDefinition[] {
    const sorted: INodeDefinition[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();

    const visit = (node: INodeDefinition): void => {
      if (visiting.has(node.id)) {
        throw new Error(`Cycle detected in graph: ${node.id}`);
      }
      if (visited.has(node.id)) {
        return;
      }

      visiting.add(node.id);

      // Visit all input nodes first
      if (node.inputs) {
        for (const inputId of node.inputs) {
          const inputNode = nodes.find(n => n.id === inputId);
          if (inputNode) {
            visit(inputNode);
          }
        }
      }

      visiting.delete(node.id);
      visited.add(node.id);
      sorted.push(node);
    };

    for (const node of nodes) {
      if (!visited.has(node.id)) {
        visit(node);
      }
    }

    return sorted;
  }
}

/**
 * Converts engine state snapshot to Build API graph definition
 * This is a simplified conversion - full reconstruction would require
 * storing original graph definition metadata
 */
function convertStateToGraphDefinition(state: EngineStateSnapshot): GraphDefinition {
  const nodes = new Map<string, import('./operator-types').NodeDefinition>();

  // Convert state nodes to Build API node definitions
  for (const [nodeId, nodeState] of Object.entries(state.nodes)) {
    nodes.set(nodeId, {
      id: nodeState.id,
      type: nodeState.type,
      inputs: nodeState.inputs ?? [],
      config: nodeState.config ?? {},
      // Note: computeFunction is lost during state export
      // This would need to be restored from original graph definition
    });
  }

  return {
    nodes,
    edges: new Map(),
    context: {},
    providers: {},
  };
}

/**
 * Adapter to convert Build API ICacheProvider to graph engine ICacheProvider
 */
class BuildApiCacheAdapter implements ICacheProvider {
  constructor(
    private readonly buildApiCache: import('../providers/interfaces/cache').ICacheProvider
  ) {}

  get<T = unknown>(_nodeId: string, _cacheKey: string): T | undefined {
    // Build API cache uses async methods, but graph engine API is sync
    // We'll need to handle this differently - for now, return undefined
    // In practice, Build API cache should be used directly in compute functions
    return undefined;
  }

  set<T = unknown>(_nodeId: string, _cacheKey: string, _value: T, _ttl?: number): void {
    // Build API cache uses async methods
    // This adapter is a placeholder - Build API cache should be used directly
  }

  invalidate(_nodeId: string, cacheKey?: string): void {
    if (cacheKey) {
      this.buildApiCache.invalidate(cacheKey).catch(() => {
        // Ignore errors
      });
    } else {
      this.buildApiCache.invalidateAll().catch(() => {
        // Ignore errors
      });
    }
  }

  invalidateAll(): void {
    this.buildApiCache.invalidateAll().catch(() => {
      // Ignore errors
    });
  }

  generateCacheKey(nodeId: string, inputs: readonly unknown[], config: unknown): string {
    return `${nodeId}:${JSON.stringify(inputs)}:${JSON.stringify(config)}`;
  }

  getStats(): CacheStats {
    const stats = this.buildApiCache.getStats();
    // Convert Build API CacheStats to graph engine CacheStats
    return {
      ...stats,
      maxSize: stats.maxSize ?? 0,
    };
  }

  cleanup(): void {
    // No-op for Build API cache
  }

  setNodeOptions(_nodeId: string, _options: unknown): void {
    // No-op for Build API cache
  }

  isCachingEnabled(_nodeId: string): boolean {
    return true;
  }
}
