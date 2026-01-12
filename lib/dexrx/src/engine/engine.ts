import {
  BehaviorSubject,
  combineLatest,
  Subscription,
  Subject,
  Observable,
  from,
  finalize,
} from 'rxjs';
import {
  takeUntil,
  distinctUntilChanged,
  debounceTime,
  mergeMap,
  catchError,
  throttleTime,
  skipWhile,
} from 'rxjs/operators';

// Import engine flags from types
import { INIT_NODE_EXEC, SKIP_NODE_EXEC } from '../types/engine-flags';

import { IGraphDefinition } from '../types/graph-definition';
import { IReactiveGraphEngine } from '../types/engine-api';
import type { EngineStateSnapshot, NodeState } from '../types/engine-state-snapshot';
import type { NodeCategory } from '../types/node-plugin';
import { INodeDefinition } from '../types/node-definition';
import { NodeRegistry } from './registry';
import { NodeWrapper, createNodeWrapper } from './node';
import { createNodeError } from '../utils/node-error';
import {
  IEngineOptions,
  DataNodesExecutionMode,
  EngineExecutionMode,
} from '../types/engine-options';
import { CacheStats, ICacheProvider } from '../types/cache-types';
import { NodeCache } from './node-cache';
import { ExecutionContext } from '../types/execution-context';
import { createExecutionContext } from '../utils/execution';
import { LoggerManager } from '../utils/logging';
import { ConsoleLoggerAdapter } from '../utils/logging/console-logger-adapter';
import { IInputGuardService } from '../types/input-guard';
import { InputGuardService } from '../utils/input-guard/input-guard-service';
import { EngineEventHandlers, EngineEventType, UnsubscribeFn } from '../types/engine-hooks';
import { isCancelableComputation } from '../types/cancelable-computation';
import { EngineState } from '../types/engine-state';
import { EngineStats } from '../types/engine-stats';
import { HookManager } from './hook-manager';
import { EngineMemoryStats } from '../types/engine-stats';
import { IEnvironmentAdapter, createEnvironmentAdapter } from '../utils/environment';
import { NodeConfig } from '../types/utils';
import { getErrorMessage } from '../utils/node-error';

// Generate unique identifier for engine instance
function generateUuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0,
      v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// Removes runtime fields from node config (shallow)
function stripRuntimeFields(config: NodeConfig): NodeConfig {
  if (!config || typeof config !== 'object') return config;

  // List of runtime fields that should not be exported
  const runtimeFields = ['__runtime', '__subject', 'triggeredNodeId'];

  // Create new object without runtime fields
  return Object.keys(config).reduce((acc, key) => {
    if (!runtimeFields.includes(key)) {
      acc[key] = config[key];
    }
    return acc;
  }, {} as NodeConfig);
}

// Converts Symbol values to strings for serialization
function serializeValue(value: unknown): unknown {
  if (value === SKIP_NODE_EXEC) return 'SKIP_NODE_EXEC';
  if (value === INIT_NODE_EXEC) return 'INIT_NODE_EXEC';
  return value;
}

// Converts strings back to Symbol values during deserialization
function deserializeValue(value: unknown): unknown {
  if (value === 'SKIP_NODE_EXEC') return SKIP_NODE_EXEC;
  if (value === 'INIT_NODE_EXEC') return INIT_NODE_EXEC;
  return value;
}

/**
 * @internal
 * Imperative API - not exported from public API
 * Use Build API (createGraph, ExecutableGraph) instead
 *
 * This class is exported for internal use only (Build API, tests within package)
 * External code should use Build API instead
 */
export class ReactiveGraphEngine implements IReactiveGraphEngine {
  private readonly defs = new Map<string, INodeDefinition>();
  private readonly wrappers = new Map<string, NodeWrapper>();
  private readonly subjects = new Map<string, BehaviorSubject<unknown>>();
  private readonly subscriptions = new Map<string, Subscription>();
  private readonly nodeDestructors = new Map<string, Subject<void>>();
  private readonly destroy$ = new Subject<void>();
  private readonly cacheProvider: ICacheProvider;
  private cacheCleanupInterval: ReturnType<typeof setInterval> | null = null;
  private executionContext?: ExecutionContext;
  private readonly logger: ConsoleLoggerAdapter;
  private readonly inputGuardService: IInputGuardService;
  private readonly activeComputations = new Map<string, { cancel: () => void }>();
  private readonly dataNodesExecutionMode: DataNodesExecutionMode;

  // 🆕 Add tracking of active Promise tasks
  private readonly activePromiseTasks = new Map<string, Promise<unknown>>();

  // 🆕 Deferred hooks for SkipInputException
  private readonly pendingSkipComputationHooks = new Set<string>();

  // Replace hooks object with hook manager
  private readonly hookManager = new HookManager();

  // New fields for lifecycle management
  private state: EngineState = EngineState.INITIALIZED;
  private readonly pausedSubscriptions = new Map<string, Subscription>();
  private readonly nodesToUpdateOnResume = new Map<string, INodeDefinition>();
  private statLoggingInterval: ReturnType<typeof setInterval> | null = null;
  private startTime = Date.now();
  private readonly engineId: string;
  private errorCount = 0;
  private computeCount = 0;
  private errorHistoryLastExecution: Array<{
    readonly timestamp: number;
    readonly nodeId: string;
    readonly message: string;
  }> = [];
  private externalSubscriptionsCount = 0;
  private readonly environmentAdapter: IEnvironmentAdapter;
  private exitHandlerUnsubscribe: (() => void) | null = null;

  constructor(
    private readonly registry: NodeRegistry,
    private readonly options: IEngineOptions = {}
  ) {
    // Initialize instance identifier
    this.engineId = options.engineId ?? generateUuid();

    // Initialize data nodes execution mode
    this.dataNodesExecutionMode =
      options.dataNodesExecutionMode ?? DataNodesExecutionMode.SYNC_EXEC_MODE;

    // Initialize loggers
    const loggerManager = LoggerManager.getInstance();

    if (options.logger) {
      loggerManager.setLogger(options.logger);
    }

    // Create logger for engine
    this.logger = new ConsoleLoggerAdapter();

    // Log engine creation with extended information
    this.logger.logEvent('engine', 'creation', {
      engineId: this.engineId,
      executionMode: options.executionMode ?? EngineExecutionMode.SERIAL,
      cacheEnabled: !!options.cacheOptions?.enabled,
      debounceTime: options.debounceTime,
      distinctValues: !!options.distinctValues,
      enableCancelableCompute: !!options.enableCancelableCompute,
      initialState: this.state,
    });

    // Log data nodes execution mode
    this.logger.logEvent('engine', 'data-nodes-execution-mode-initialized', {
      dataNodesExecutionMode: this.dataNodesExecutionMode,
      engineId: this.engineId,
    });

    // Initialize input data validation service
    if (options.inputGuardService) {
      this.inputGuardService = options.inputGuardService;
    } else {
      this.inputGuardService = new InputGuardService();
      this.inputGuardService.setLogger(this.logger);
    }

    // Initialize cache
    if (options.cacheOptions?.provider) {
      // Use user-provided cache provider
      this.cacheProvider = options.cacheOptions.provider;

      this.logger.inputGuardWarn('Using custom cache provider', true);
      this.logger.logEvent('engine', 'custom-cache-provider', {
        stats: this.cacheProvider.getStats() as unknown as import('../types/utils').Serializable,
      });
    } else {
      // Create built-in cache (for compatibility)
      this.cacheProvider = new NodeCache(options.cacheOptions);
      this.logger.logEvent('engine', 'internal-cache-provider', {
        options: options.cacheOptions as unknown as import('../types/utils').Serializable,
      });
    }

    // If automatic cache cleanup is enabled, set up interval
    if (options.cacheOptions?.enabled && (options.cacheOptions.defaultTtl ?? 0) > 0) {
      this.cacheCleanupInterval = setInterval(
        () => {
          this.cacheProvider.cleanup();
          this.logger.logEvent('engine', 'cache-cleanup', {
            stats:
              this.cacheProvider.getStats() as unknown as import('../types/utils').Serializable,
          });
        },
        Math.max((options.cacheOptions.defaultTtl ?? 60000) / 10, 10000)
      );
    }

    // Initialize execution context
    if (options.executionContext) {
      // Use explicitly provided execution context
      this.executionContext = options.executionContext;
      this.logger.logEvent('engine', 'custom-execution-context', {
        type: this.executionContext.constructor.name,
      });
    } else if (options.executionMode === EngineExecutionMode.PARALLEL) {
      // Create context according to settings and mode
      // Pass logger to execution context for debugging
      const parallelOptionsWithLogger = {
        ...options.parallelOptions,
        logger: this.logger,
      };
      this.executionContext = createExecutionContext(
        registry,
        parallelOptionsWithLogger,
        EngineExecutionMode.PARALLEL
      );
      this.logger.logEvent('engine', 'create-parallel-context', {
        parallelOptions:
          options.parallelOptions as unknown as import('../types/utils').Serializable,
      });
    }

    // Call initialization hook
    this.hookManager.emit(EngineEventType.ENGINE_INITIALIZED, options);

    // Initialize environment adapter
    this.environmentAdapter = options.environmentAdapter ?? createEnvironmentAdapter();

    // Set up periodic statistics logging
    this.setupStatsLogging();

    // Auto-start by default if option is not explicitly set
    const shouldAutoStart = options.autoStart !== false; // Default true
    if (shouldAutoStart) {
      this.start();
    }
  }

  private detectCycle(startId: string, visited: Set<string> = new Set()): boolean {
    // If node was already visited in current path, it's a cycle
    if (visited.has(startId)) {
      return true;
    }

    // Add node to visited list
    visited.add(startId);

    // Get node definition
    const def = this.defs.get(startId);
    if (!def?.inputs?.length) {
      // Node without inputs cannot create cycle
      return false;
    }

    // Check all node inputs
    for (const inputId of def.inputs) {
      // If input node was already visited in current path or itself contains cycle,
      // then current node is also part of cycle
      if (visited.has(inputId) || this.detectCycle(inputId, new Set(visited))) {
        this.logger.logEvent('engine', 'cycle-detection', {
          startNodeId: startId,
          cycleNodeId: inputId,
        });
        return true;
      }
    }

    // If no input created cycle, node is not part of cycle
    return false;
  }

  private handleComputeError(nodeId: string, error: unknown): null {
    const errorName = error instanceof Error ? error.name : undefined;
    const errorMessage = getErrorMessage(error);

    this.logger.logEvent('engine', 'handle-compute-error', {
      nodeId,
      errorName,
      errorMessage,
      errorType: typeof error,
    });

    // If this is SkipInputException — handle differently for SINGLE and BLOCK modes
    if (errorName === 'SkipInputException') {
      this.logger.logEvent('engine', 'skip-input-exception-detected', {
        nodeId,
        engineState: this.state,
        dataNodesExecutionMode: this.dataNodesExecutionMode,
      });

      if (this.dataNodesExecutionMode === DataNodesExecutionMode.ASYNC_EXEC_MODE) {
        // ASYNC mode: stop engine when data node is skipped
        this.logger.logEvent('engine', 'async-mode-pause-on-skip', {
          nodeId,
          engineState: this.state,
        });

        if (this.state === EngineState.RUNNING) {
          this.pause();
        }
      } else if (this.dataNodesExecutionMode === DataNodesExecutionMode.SYNC_EXEC_MODE) {
        // SYNC mode: DO NOT stop engine, continue execution
        this.logger.logEvent('engine', 'sync-mode-continue-on-skip', {
          nodeId,
          engineState: this.state,
          reason: 'SYNC_EXEC_MODE allows engine to continue running after SKIP_NODE_EXEC',
        });

        this.logger.debug(
          `🔄 [ENGINE] SYNC_EXEC_MODE: node ${nodeId} returned SKIP_NODE_EXEC, but engine continues running`
        );
        // DO NOT call this.pause() - engine continues working!
      }

      // 🆕 Call hook only if there are no active Promise tasks
      this.emitSkipComputationHookIfReady(nodeId);

      return null;
    }

    // Account error in statistics
    this.errorCount++;
    this.errorHistoryLastExecution.push({
      timestamp: Date.now(),
      nodeId,
      message: getErrorMessage(error),
    });

    // Limit error history size
    const maxHistorySize = 1000;
    if (this.errorHistoryLastExecution.length > maxHistorySize) {
      this.errorHistoryLastExecution = this.errorHistoryLastExecution.slice(-maxHistorySize);
    }

    // Original logic
    const nodeError = createNodeError(
      `Node computation error: ${getErrorMessage(error)}`,
      nodeId,
      error instanceof Error ? error : undefined
    );

    this.logger.logEvent('engine', 'node-compute-error', {
      nodeId,
      errorMessage,
      errorType: error instanceof Error ? error.constructor.name : typeof error,
      totalErrors: this.errorCount,
    });

    if (!this.options.silentErrors) {
      this.logger.inputGuardError(`Computation error in node ${nodeId}`, nodeError, false);
    }

    this.hookManager.emit(EngineEventType.NODE_COMPUTE_ERROR, nodeId, nodeError);
    return null;
  }

  /**
   * Validates and sanitizes input data for node
   * @param def Node definition
   * @returns Sanitized definition or original if sanitizeInput = false
   */
  private validateAndSanitizeNode(def: INodeDefinition): INodeDefinition {
    try {
      // Check ID for safety
      if (!def.id || typeof def.id !== 'string') {
        throw new Error('Node identifier must be a string');
      }

      // If sanitizeInput option is enabled, clean data
      if (this.options.sanitizeInput) {
        const maxDepth = this.options.maxDepth ?? 10;

        // Deep sanitization of configuration using inputGuardService
        const sanitizedConfig = def.config
          ? (this.inputGuardService.deepSanitize(def.config, 0, maxDepth) as NodeConfig)
          : def.config;

        // Check array of input nodes
        let sanitizedInputs = def.inputs;
        if (Array.isArray(def.inputs)) {
          sanitizedInputs = def.inputs
            .filter(id => typeof id === 'string')
            .map(id =>
              this.inputGuardService.isSafeString(id)
                ? id
                : this.inputGuardService.sanitizeString(id)
            );
        }

        // Return cleaned definition
        return {
          ...def,
          config: sanitizedConfig,
          inputs: sanitizedInputs,
        };
      }

      return def;
    } catch (error) {
      // Log security issue
      this.logger.inputGuardError(
        `Unsafe node definition: ${def.id}`,
        error instanceof Error ? error : undefined
      );

      // Return original definition, but in real scenarios can throw exception
      return def;
    }
  }

  /**
   * Registers handler for event
   * @param eventType Event type
   * @param handler Event handler
   * @returns Function to cancel registration
   */
  on<K extends keyof EngineEventHandlers>(
    eventType: K,
    handler: EngineEventHandlers[K]
  ): UnsubscribeFn {
    return this.hookManager.on(eventType, handler);
  }

  addNode(def: INodeDefinition): void {
    // State check
    if (this.state === EngineState.DESTROYED) {
      const error = new Error(`Cannot add node in destroyed engine`);
      this.logger.inputGuardError(error.message);
      throw error;
    }

    return this.logger.measureTime('engine', 'add-node', () => {
      // Validate and sanitize input data
      const sanitizedDef = this.validateAndSanitizeNode(def);

      if (this.defs.has(sanitizedDef.id)) {
        this.logger.logEvent('engine', 'node-already-exists', { nodeId: sanitizedDef.id });
        throw new Error(`Node with id '${sanitizedDef.id}' already exists.`);
      }

      this.defs.set(sanitizedDef.id, sanitizedDef);
      this.hookManager.emit(EngineEventType.NODE_ADDED, sanitizedDef.id, sanitizedDef);

      if (this.detectCycle(sanitizedDef.id)) {
        this.defs.delete(sanitizedDef.id);
        this.logger.logEvent('engine', 'cycle-detected', { nodeId: sanitizedDef.id });
        const error = new Error(`Cycle detected when adding node '${sanitizedDef.id}'`);
        this.logger.inputGuardError(`Cycle detected when adding node ${sanitizedDef.id}`);
        throw error;
      }

      const plugin = this.registry.get(sanitizedDef.type);

      // Create wrapper with execution context
      const wrapper = createNodeWrapper(
        plugin,
        sanitizedDef.config ?? {},
        this.options.executionMode === EngineExecutionMode.PARALLEL
          ? this.executionContext
          : undefined
      );

      const subject = new BehaviorSubject<unknown>(INIT_NODE_EXEC);

      // 🔧 ADD subject to config wrapper for data nodes
      // Category comes from plugin, fallback to config for backward compatibility
      const category: NodeCategory | undefined =
        plugin.category ?? (sanitizedDef.config?.category as NodeCategory | undefined);
      if (category === 'data' && wrapper && 'config' in wrapper) {
        const wrapperWithConfig = wrapper as unknown as { config: Record<string, unknown> };
        wrapperWithConfig.config.__subject = subject;
        this.logger.logEvent('engine', 'wrapper-config-initialized', {
          nodeId: sanitizedDef.id,
          type: sanitizedDef.type,
          category,
          hasSubject: !!wrapperWithConfig.config.__subject,
        });
      }

      // Set cache options for node if specified
      if (sanitizedDef.cacheOptions) {
        this.cacheProvider.setNodeOptions(sanitizedDef.id, sanitizedDef.cacheOptions);
      }

      // Store wrapper and subject
      this.wrappers.set(sanitizedDef.id, wrapper);
      this.subjects.set(sanitizedDef.id, subject);

      // Create destructor
      const destroy$ = new Subject<void>();
      this.nodeDestructors.set(sanitizedDef.id, destroy$);

      this.logger.logEvent('engine', 'node-setup', {
        nodeId: sanitizedDef.id,
        type: sanitizedDef.type,
        inputsCount: (sanitizedDef.inputs ?? []).length,
        hasConfig: !!sanitizedDef.config,
        hasCacheOptions: !!sanitizedDef.cacheOptions,
        engineState: this.state,
      });

      // If engine is running, create subscriptions
      if (this.state === EngineState.RUNNING) {
        const inputStreams = (sanitizedDef.inputs ?? []).map(
          inputId => this.subjects.get(inputId) ?? new BehaviorSubject<unknown>(INIT_NODE_EXEC)
        );

        if (inputStreams.length === 0) {
          // immediate compute for zero-input nodes
          try {
            // 🔧 INCREASE computeCount for data nodes without inputs
            this.computeCount++;

            const result = wrapper.compute([]);

            // If result is Promise, handle asynchronously
            if (result instanceof Promise) {
              this.logger.logEvent('engine', 'promise-detected', {
                nodeId: sanitizedDef.id,
                type: sanitizedDef.type,
              });

              // 🆕 Add Promise to active tasks tracking
              this.activePromiseTasks.set(sanitizedDef.id, result);

              result
                .then(
                  value => {
                    subject.next(value);
                    this.logger.logEvent('engine', 'async-compute-success', {
                      nodeId: sanitizedDef.id,
                      type: sanitizedDef.type,
                      valueType: typeof value,
                    });
                  },
                  error => {
                    this.handleComputeError(sanitizedDef.id, error);
                    subject.next(null);
                  }
                )
                .finally(() => {
                  // 🆕 Remove Promise from tracking when it completes
                  this.activePromiseTasks.delete(sanitizedDef.id);
                  this.logger.logEvent('engine', 'promise-completed', {
                    nodeId: sanitizedDef.id,
                    type: sanitizedDef.type,
                  });

                  // 🆕 Check deferred hooks
                  this.checkAndEmitPendingSkipComputationHooks();
                });
            } else {
              subject.next(result);
              this.logger.logEvent('engine', 'sync-compute-success', {
                nodeId: sanitizedDef.id,
                type: sanitizedDef.type,
                valueType: typeof result,
              });
            }
          } catch (error) {
            // Safely handle compute error - wrap in try-catch to prevent error propagation
            try {
              this.handleComputeError(sanitizedDef.id, error);
            } catch (handleError) {
              // If handleComputeError itself throws, log it but don't propagate
              this.logger.error('Error in handleComputeError', handleError);
            }
            subject.next(null);
          }
          return;
        }

        // Create processing pipeline
        let pipeline = combineLatest(inputStreams).pipe(
          takeUntil(this.destroy$),
          takeUntil(destroy$),
          skipWhile(values => values.includes(INIT_NODE_EXEC)), // Wait until all nodes are initialized
          mergeMap(values => Promise.all(values)) // Wait until all promises resolve
        );

        // Apply optional debounce
        if (this.options.debounceTime && this.options.debounceTime > 0) {
          pipeline = pipeline.pipe(debounceTime(this.options.debounceTime));
        }

        // Apply optional throttle
        if (this.options.throttleTime && this.options.throttleTime > 0) {
          pipeline = pipeline.pipe(throttleTime(this.options.throttleTime));
        }

        // Apply optional distinctUntilChanged
        if (this.options.distinctValues) {
          pipeline = pipeline.pipe(
            distinctUntilChanged((prev, curr) => JSON.stringify(prev) === JSON.stringify(curr))
          );
        }

        // Apply computation with error handling, supporting async operations
        pipeline = pipeline.pipe(
          mergeMap(values => {
            try {
              this.computeCount++;

              this.logger.logEvent('engine', 'node-inputs-changed', {
                nodeId: sanitizedDef.id,
                inputCount: values.length,
              });

              // Cancel previous task
              if (this.options.enableCancelableCompute) {
                const currentTask = this.activeComputations.get(sanitizedDef.id);
                if (currentTask) {
                  try {
                    currentTask.cancel();
                    this.logger.logEvent('engine', 'task-cancelled', {
                      nodeId: sanitizedDef.id,
                      reason: 'new-computation',
                    });
                  } catch (error) {
                    const errorMessage = error instanceof Error ? error : new Error(String(error));
                    this.logger.inputGuardError(
                      `Error cancelling task: ${sanitizedDef.id}`,
                      errorMessage
                    );
                    this.logger.logEvent('engine', 'task-cancel-error', {
                      nodeId: sanitizedDef.id,
                      error: errorMessage.message,
                    });
                  }
                }
                this.activeComputations.delete(sanitizedDef.id);
              }

              const result = wrapper.compute(values);

              // Replace check with cancelable result
              if (this.options.enableCancelableCompute && isCancelableComputation(result)) {
                if (result.cancel) {
                  this.activeComputations.set(sanitizedDef.id, { cancel: result.cancel });
                }

                return from(result.promise).pipe(
                  catchError(error => {
                    this.handleComputeError(sanitizedDef.id, error);
                    return from([null]);
                  })
                );
              }

              // regular Promise
              if (result instanceof Promise) {
                this.logger.logEvent('engine', 'promise-detected', {
                  nodeId: sanitizedDef.id,
                  type: sanitizedDef.type,
                });

                // 🆕 Add Promise to active tasks tracking
                this.activePromiseTasks.set(sanitizedDef.id, result);

                return from(result).pipe(
                  catchError(error => {
                    this.logger.logEvent('engine', 'promise-rejected', {
                      nodeId: sanitizedDef.id,
                      error: error instanceof Error ? error.message : String(error),
                    });
                    this.handleComputeError(sanitizedDef.id, error);
                    return from([null]);
                  }),
                  // 🆕 Remove Promise from tracking when it completes
                  finalize(() => {
                    this.activePromiseTasks.delete(sanitizedDef.id);
                    this.logger.logEvent('engine', 'promise-completed', {
                      nodeId: sanitizedDef.id,
                      type: sanitizedDef.type,
                    });

                    // 🆕 Check deferred hooks
                    this.checkAndEmitPendingSkipComputationHooks();
                  })
                );
              }

              // regular value
              return from([result]);
            } catch (error) {
              this.handleComputeError(sanitizedDef.id, error);
              return from([null]);
            }
          })
        );

        // Subscribe and store subscription
        const sub = pipeline.subscribe(result => {
          this.logger.logEvent('engine', 'node-value-update', {
            nodeId: sanitizedDef.id,
            hasValue: result !== null && result !== undefined,
            valueType: typeof result,
            isPromise: result instanceof Promise,
          });
          subject.next(result);
        });

        this.subscriptions.set(sanitizedDef.id, sub);
      } else {
        // If engine is not running, log but don't create subscriptions
        this.logger.logEvent('engine', 'node-added-while-not-running', {
          nodeId: sanitizedDef.id,
          engineState: this.state,
        });
      }
    });
  }

  updateNode(id: string, def: INodeDefinition): void {
    // State check
    if (this.state === EngineState.DESTROYED) {
      const error = new Error(`Cannot update node in destroyed engine`);
      this.logger.inputGuardError(error.message);
      throw error;
    }

    // If engine is paused, save update for application on resume
    if (this.state === EngineState.PAUSED) {
      this.nodesToUpdateOnResume.set(id, def);
      this.logger.logEvent('engine', 'update-deferred', {
        nodeId: id,
        engineState: this.state,
      });
      return;
    }

    return this.logger.measureTime('engine', 'update-node', () => {
      // Validate and sanitize input data
      const sanitizedDef = this.validateAndSanitizeNode(def);

      this.logger.logEvent('engine', 'node-update-start', {
        nodeId: id,
        newType: sanitizedDef.type,
        inputsCount: sanitizedDef.inputs?.length ?? 0,
        hasConfig: !!sanitizedDef.config,
        engineState: this.state,
      });

      const oldSubject = this.subjects.get(id);

      if (!oldSubject) {
        this.logger.logEvent('engine', 'node-update-error', {
          nodeId: id,
          error: 'Subject not found',
        });
        const error = new Error(`Subject for node '${id}' not found`);
        this.logger.inputGuardError(`Subject not found for node: ${id}`);
        throw error;
      }

      // Save old definition for cycle check
      const oldDef = this.defs.get(id);

      if (!oldDef) {
        this.logger.logEvent('engine', 'node-update-error', {
          nodeId: id,
          error: 'Definition not found',
        });
        this.logger.inputGuardError(`Node definition not found: ${id}`);
        throw new Error(`Definition for node '${id}' not found`);
      }

      // Update definition for cycle check
      this.defs.set(id, sanitizedDef);

      // Check if cycle appeared after update
      if (this.detectCycle(id)) {
        // If cycle detected, restore previous definition
        this.defs.set(id, oldDef);

        this.logger.logEvent('engine', 'cycle-detected-on-update', { nodeId: id });
        const error = new Error(`Cycle detected when updating node '${id}'`);
        this.logger.inputGuardError(`Cycle detected when updating node ${id}`);
        throw error;
      }

      this.hookManager.emit(EngineEventType.NODE_UPDATED, id, oldDef, sanitizedDef);

      // Clean up old node resources but preserve subject
      this.cleanupNode(id, true);

      const plugin = this.registry.get(sanitizedDef.type);

      // Create wrapper with execution context
      const wrapper = createNodeWrapper(
        plugin,
        sanitizedDef.config ?? {},
        this.options.executionMode === EngineExecutionMode.PARALLEL
          ? this.executionContext
          : undefined
      );

      // 🔧 ADD subject to config wrapper for data nodes
      // Category comes from plugin, fallback to config for backward compatibility
      const category: NodeCategory | undefined =
        plugin.category ?? (sanitizedDef.config?.category as NodeCategory | undefined);
      if (category === 'data' && wrapper && 'config' in wrapper) {
        const wrapperWithConfig = wrapper as unknown as { config: Record<string, unknown> };
        wrapperWithConfig.config.__subject = oldSubject;
        this.logger.logEvent('engine', 'wrapper-config-updated', {
          nodeId: id,
          type: sanitizedDef.type,
          category,
          hasSubject: !!wrapperWithConfig.config.__subject,
        });
      }

      // Set cache options for node if specified
      if (sanitizedDef.cacheOptions) {
        this.cacheProvider.setNodeOptions(id, sanitizedDef.cacheOptions);
      }

      // Create destructor for new node
      const destroy$ = new Subject<void>();

      // Store wrapper and destructor
      this.wrappers.set(id, wrapper);
      this.nodeDestructors.set(id, destroy$);

      // If engine is running, create subscriptions
      if (this.state === EngineState.RUNNING) {
        const inputStreams = (sanitizedDef.inputs ?? []).map(
          inputId => this.subjects.get(inputId) ?? new BehaviorSubject<unknown>(INIT_NODE_EXEC)
        );

        // Zero input case
        if (inputStreams.length === 0) {
          try {
            // 🔧 INCREASE computeCount for data nodes without inputs
            this.computeCount++;

            const result = wrapper.compute([]);

            // If result is Promise, handle asynchronously
            if (result instanceof Promise) {
              this.logger.logEvent('engine', 'promise-detected', {
                nodeId: id,
                type: sanitizedDef.type,
              });

              // 🆕 Add Promise to active tasks tracking
              this.activePromiseTasks.set(id, result);

              result
                .then(
                  value => oldSubject.next(value),
                  error => {
                    this.handleComputeError(id, error);
                    oldSubject.next(null);
                  }
                )
                .finally(() => {
                  // 🆕 Remove Promise from tracking when it completes
                  this.activePromiseTasks.delete(id);
                  this.logger.logEvent('engine', 'promise-completed', {
                    nodeId: id,
                    type: sanitizedDef.type,
                  });

                  // 🆕 Check deferred hooks
                  this.checkAndEmitPendingSkipComputationHooks();
                });
            } else {
              oldSubject.next(result);
            }
          } catch (error) {
            // Safely handle compute error - wrap in try-catch to prevent error propagation
            try {
              this.handleComputeError(id, error);
            } catch (handleError) {
              // If handleComputeError itself throws, log it but don't propagate
              this.logger.error('Error in handleComputeError', handleError);
            }
            oldSubject.next(null);
          }
          return;
        }

        // Create processing pipeline
        let pipeline = combineLatest(inputStreams).pipe(
          takeUntil(this.destroy$),
          takeUntil(destroy$),
          skipWhile(values => values.includes(INIT_NODE_EXEC)), // Wait until all nodes are initialized
          mergeMap(values => Promise.all(values)) // Wait until all promises resolve
        );

        if (this.options.debounceTime && this.options.debounceTime > 0) {
          pipeline = pipeline.pipe(debounceTime(this.options.debounceTime));
        }

        if (this.options.throttleTime && this.options.throttleTime > 0) {
          pipeline = pipeline.pipe(throttleTime(this.options.throttleTime));
        }

        if (this.options.distinctValues) {
          pipeline = pipeline.pipe(
            distinctUntilChanged((prev, curr) => JSON.stringify(prev) === JSON.stringify(curr))
          );
        }

        // Apply computation with error handling
        pipeline = pipeline.pipe(
          mergeMap(values => {
            try {
              this.computeCount++;

              // Cancel previous task
              if (this.options.enableCancelableCompute) {
                const currentTask = this.activeComputations.get(id);
                if (currentTask) {
                  try {
                    currentTask.cancel();
                    this.logger.logEvent('engine', 'task-cancelled', {
                      nodeId: id,
                      reason: 'update-node',
                    });
                  } catch (error) {
                    const errorMessage = error instanceof Error ? error : new Error(String(error));
                    this.logger.inputGuardError(`Error cancelling task: ${id}`, errorMessage);
                    this.logger.logEvent('engine', 'task-cancel-error', {
                      nodeId: id,
                      error: errorMessage.message,
                    });
                  }
                }
                this.activeComputations.delete(id);
              }

              const result = wrapper.compute(values);

              // Replace check with cancelable result
              if (this.options.enableCancelableCompute && isCancelableComputation(result)) {
                if (result.cancel) {
                  this.activeComputations.set(id, { cancel: result.cancel });
                }

                return from(result.promise).pipe(
                  catchError(error => {
                    this.handleComputeError(id, error);
                    return from([null]);
                  })
                );
              }

              // Regular Promise
              if (result instanceof Promise) {
                this.logger.logEvent('engine', 'promise-detected', {
                  nodeId: id,
                  type: sanitizedDef.type,
                });

                // 🆕 Add Promise to active tasks tracking
                this.activePromiseTasks.set(id, result);

                return from(result).pipe(
                  catchError(error => {
                    this.logger.logEvent('engine', 'promise-rejected', {
                      nodeId: id,
                      error: error instanceof Error ? error.message : String(error),
                    });
                    this.handleComputeError(id, error);
                    return from([null]);
                  }),
                  // 🆕 Remove Promise from tracking when it completes
                  finalize(() => {
                    this.activePromiseTasks.delete(id);
                    this.logger.logEvent('engine', 'promise-completed', {
                      nodeId: id,
                      type: sanitizedDef.type,
                    });

                    // 🆕 Check deferred hooks
                    this.checkAndEmitPendingSkipComputationHooks();
                  })
                );
              }

              // Synchronous value
              return from([result]);
            } catch (error) {
              this.handleComputeError(id, error);
              return from([null]);
            }
          })
        );

        // Subscribe and store subscription
        const sub = pipeline.subscribe(result => {
          this.logger.logEvent('engine', 'node-value-update', {
            nodeId: id,
            hasValue: result !== null && result !== undefined,
            valueType: typeof result,
            isPromise: result instanceof Promise,
          });
          oldSubject.next(result);
        });

        this.subscriptions.set(id, sub);
      } else {
        // If engine is not running, log but don't create subscriptions
        this.logger.logEvent('engine', 'node-updated-while-not-running', {
          nodeId: id,
          engineState: this.state,
        });
      }
    });
  }

  private cleanupNode(id: string, preserveSubject = false): void {
    this.logger.logEvent('engine', 'node-cleanup', {
      nodeId: id,
      preserveSubject,
    });

    // Cancel existing subscription
    this.subscriptions.get(id)?.unsubscribe();
    this.subscriptions.delete(id);

    // Signal node destruction
    const destroyer = this.nodeDestructors.get(id);
    if (destroyer) {
      destroyer.next();
      destroyer.complete();
      this.nodeDestructors.delete(id);
    }

    // Cleanup wrapper
    this.wrappers.get(id)?.destroy();
    this.wrappers.delete(id);

    // Optionally complete the subject
    if (!preserveSubject) {
      this.subjects.get(id)?.complete();
      this.subjects.delete(id);
    }

    // Cleanup active tasks with error handling and logging
    if (this.options.enableCancelableCompute) {
      const task = this.activeComputations.get(id);
      if (task) {
        try {
          task.cancel();
          this.logger.logEvent('engine', 'computation-cancelled', {
            nodeId: id,
            reason: 'node-cleanup',
          });
        } catch (error) {
          const errorMessage = error instanceof Error ? error : new Error(String(error));
          this.logger.inputGuardError(
            `Error cancelling task during node cleanup: ${id}`,
            errorMessage
          );
          this.logger.logEvent('engine', 'computation-cancel-error', {
            nodeId: id,
            error: errorMessage.message,
          });
        }
        this.activeComputations.delete(id);
      }
    }

    // 🆕 Cleanup active Promise tasks
    if (this.activePromiseTasks.has(id)) {
      this.activePromiseTasks.delete(id);
      this.logger.logEvent('engine', 'promise-task-cleanup', {
        nodeId: id,
        reason: 'node-cleanup',
      });
    }

    // 🆕 Cleanup deferred hooks for this node
    if (this.pendingSkipComputationHooks.has(id)) {
      this.pendingSkipComputationHooks.delete(id);
      this.logger.logEvent('engine', 'pending-hook-cleanup', {
        nodeId: id,
        reason: 'node-cleanup',
      });
    }
  }

  removeNode(id: string, preserveSubject = false): void {
    this.logger.measureTime('engine', 'remove-node', () => {
      // Check node existence
      if (!this.defs.has(id)) {
        this.logger.logEvent('engine', 'remove-nonexistent-node', { nodeId: id });
        this.logger.inputGuardWarn(`Attempt to remove non-existent node: ${id}`);
      } else {
        this.logger.logEvent('engine', 'node-removed', {
          nodeId: id,
          preserveSubject,
        });
      }

      this.cleanupNode(id, preserveSubject);
      this.defs.delete(id);
      this.hookManager.emit(EngineEventType.NODE_REMOVED, id);

      // Update dependent nodes
      for (const [nodeId, def] of this.defs.entries()) {
        if ((def.inputs ?? []).includes(id)) {
          const updatedInputs = (def.inputs ?? []).filter(inputId => inputId !== id);
          const updatedDef: INodeDefinition = { ...def, inputs: updatedInputs };

          this.logger.logEvent('engine', 'update-dependent-node', {
            nodeId,
            removedInputId: id,
            remainingInputsCount: updatedInputs.length,
          });

          this.updateNode(nodeId, updatedDef);
        }
      }
    });
  }

  observeNode<T = unknown>(id: string): Observable<T> | undefined {
    // Check node existence
    if (!this.subjects.has(id)) {
      this.logger.logEvent('engine', 'observe-nonexistent-node', { nodeId: id });
      this.logger.inputGuardWarn(`Attempt to observe non-existent node: ${id}`, true);
      return undefined;
    } else {
      this.logger.logEvent('engine', 'node-observed', { nodeId: id });

      // Return Observable tracking external subscriptions
      const subject = this.subjects.get(id);
      if (subject) {
        this.externalSubscriptionsCount++;

        // Wrap original Observable for subscription tracking
        return new Observable<T>(observer => {
          const subscription = (subject.asObservable() as Observable<T>).subscribe(observer);

          // On unsubscribe decrease counter
          return () => {
            subscription.unsubscribe();
            this.externalSubscriptionsCount--;
          };
        });
      }

      return undefined;
    }
  }

  destroy(): void {
    if (this.state === EngineState.DESTROYED) {
      this.logger.logEvent('engine', 'destroy-skipped', {
        reason: 'already-destroyed',
        engineId: this.engineId,
      });
      return;
    }

    const previousState = this.state;
    this.state = EngineState.STOPPING;

    // Call hook before destruction
    this.hookManager.emit(EngineEventType.BEFORE_DESTROY);

    this.logger.logEvent('engine', 'destroy', {
      engineId: this.engineId,
      previousState,
      nodesCount: this.defs.size,
      hasExecutionContext: !!this.executionContext,
      activeTasksCount: this.activeComputations.size + this.activePromiseTasks.size,
    });

    // Clear cache cleanup timer if it was set
    if (this.cacheCleanupInterval) {
      clearInterval(this.cacheCleanupInterval);
      this.cacheCleanupInterval = null;
    }

    // Clear statistics logging timer
    if (this.statLoggingInterval) {
      clearInterval(this.statLoggingInterval);
      this.statLoggingInterval = null;
    }

    // Log engine destruction
    this.logger.inputGuardWarn(`Destroying ReactiveGraphEngine with ${this.defs.size} nodes`, true);

    // Close execution context if it exists
    if (this.executionContext) {
      try {
        this.executionContext.terminate();
        // If execution context has waitForTermination method (NodeWorkerContext), wait for workers to close
        const contextWithWait = this.executionContext as ExecutionContext & {
          waitForTermination?: (timeoutMs: number) => Promise<void>;
        };
        if (typeof contextWithWait.waitForTermination === 'function') {
          // Fire and forget - don't block destroy(), but ensure workers close
          contextWithWait.waitForTermination(1000).catch(() => {
            // Ignore errors
          });
        }
        this.logger.logEvent('engine', 'execution-context-terminated', {
          type: this.executionContext.constructor.name,
        });
      } catch (error) {
        this.logger.logEvent('engine', 'execution-context-error', {
          error: error instanceof Error ? error.message : String(error),
        });
        this.logger.inputGuardError(
          'Error releasing execution context',
          error instanceof Error ? error : undefined
        );
      }
      this.executionContext = undefined;
    }

    // Cleanup all active tasks
    if (this.options.enableCancelableCompute) {
      for (const [nodeId, task] of this.activeComputations.entries()) {
        try {
          task.cancel();
          this.logger.logEvent('engine', 'task-cancelled', {
            nodeId,
            reason: 'engine-destroy',
          });
        } catch (error) {
          const errorMessage = error instanceof Error ? error : new Error(String(error));
          this.logger.inputGuardError(
            `Error cancelling task during engine destruction: ${nodeId}`,
            errorMessage
          );
          this.logger.logEvent('engine', 'task-cancel-error', {
            nodeId,
            error: errorMessage.message,
          });
        }
      }
      this.activeComputations.clear();
    }

    // 🆕 Cleanup all active Promise tasks
    if (this.activePromiseTasks.size > 0) {
      this.logger.logEvent('engine', 'promise-tasks-cleanup', {
        taskCount: this.activePromiseTasks.size,
        reason: 'engine-destroy',
      });
      this.activePromiseTasks.clear();
    }

    // 🆕 Cleanup pending hooks
    if (this.pendingSkipComputationHooks.size > 0) {
      this.logger.logEvent('engine', 'pending-hooks-cleanup', {
        hookCount: this.pendingSkipComputationHooks.size,
        reason: 'engine-destroy',
      });
      this.pendingSkipComputationHooks.clear();
    }

    // Cancel all deferred updates
    this.nodesToUpdateOnResume.clear();

    // Trigger global destruction signal
    this.destroy$.next();
    this.destroy$.complete();

    // Clean up node-specific resources
    this.nodeDestructors.forEach(destroyer => {
      destroyer.next();
      destroyer.complete();
    });

    // Clean up remaining subscriptions
    this.subscriptions.forEach(s => s.unsubscribe());
    this.pausedSubscriptions.forEach(s => s.unsubscribe());
    this.wrappers.forEach(w => w.destroy());

    // Clear all collections
    this.defs.clear();
    this.wrappers.clear();
    this.subjects.clear();
    this.subscriptions.clear();
    this.pausedSubscriptions.clear();
    this.nodeDestructors.clear();

    // Update state to DESTROYED
    this.state = EngineState.DESTROYED;

    // Call hook after destruction
    this.hookManager.emit(EngineEventType.AFTER_DESTROY);

    // Call state change hook
    this.hookManager.emit(EngineEventType.ENGINE_STATE_CHANGED, previousState, this.state);

    // Clear all hooks
    this.hookManager.clearAllEvents();

    // Unsubscribe from exit events
    if (this.exitHandlerUnsubscribe) {
      this.exitHandlerUnsubscribe();
      this.exitHandlerUnsubscribe = null;
    }
  }

  /**
   * Gets cache usage statistics
   * @returns Cache statistics or null if caching is disabled
   */
  public getCacheStats(): CacheStats | null {
    const stats = this.cacheProvider ? this.cacheProvider.getStats() : null;

    this.logger.logEvent('engine', 'cache-stats-requested', {
      hasStats: !!stats,
      ...stats,
    });

    return stats;
  }

  /**
   * Clears cache for all nodes or for specific node
   * @param nodeId Node identifier (if not specified, entire cache is cleared)
   */
  public clearCache(nodeId?: string): void {
    if (!this.cacheProvider) {
      this.logger.logEvent('engine', 'cache-clear-skipped', {
        reason: 'Cache provider not available',
        targetNodeId: nodeId,
      });
      return;
    }

    this.logger.logEvent('engine', 'cache-clear', {
      targetNodeId: nodeId ?? 'all',
      statsBeforeClear:
        this.cacheProvider.getStats() as unknown as import('../types/utils').Serializable,
    });

    if (nodeId) {
      this.cacheProvider.invalidate(nodeId);
    } else {
      this.cacheProvider.invalidateAll();
    }
  }

  /**
   * Precomputes and caches node value with specified input data
   * @param nodeId Node identifier
   * @param inputs Input data for precomputation
   * @returns Promise that resolves when precomputation is complete
   */
  public async precomputeNode(nodeId: string, inputs: unknown[]): Promise<void> {
    return this.logger.measureTime('engine', 'precompute-node', async () => {
      this.logger.logEvent('engine', 'precompute-start', {
        nodeId,
        inputsCount: inputs.length,
      });

      if (!this.defs.has(nodeId)) {
        this.logger.logEvent('engine', 'precompute-error', {
          nodeId,
          error: 'Node not found',
        });
        throw new Error(`Node with id '${nodeId}' not found`);
      }

      const def = this.defs.get(nodeId);
      if (!def) {
        this.logger.logEvent('engine', 'precompute-error', {
          nodeId,
          error: 'Node definition not found',
        });
        throw new Error(`Node with id '${nodeId}' not found`);
      }
      const wrapper = this.wrappers.get(nodeId);

      if (!wrapper) {
        this.logger.logEvent('engine', 'precompute-error', {
          nodeId,
          error: 'Node wrapper not found',
        });
        throw new Error(`Wrapper for node '${nodeId}' not found`);
      }

      // Generate cache key
      const cacheKey = this.cacheProvider.generateCacheKey(nodeId, inputs, def.config ?? {});

      try {
        // Compute and cache result
        const result = wrapper.compute(inputs);

        // If result is Promise, wait for it to resolve
        if (result instanceof Promise) {
          const value = await result;
          this.cacheProvider.set(nodeId, cacheKey, value);
          this.logger.logEvent('engine', 'precompute-async-success', {
            nodeId,
            valueType: typeof value,
          });
        } else {
          this.cacheProvider.set(nodeId, cacheKey, result);
          this.logger.logEvent('engine', 'precompute-sync-success', {
            nodeId,
            valueType: typeof result,
          });
        }
      } catch (error) {
        this.logger.logEvent('engine', 'precompute-error', {
          nodeId,
          error: error instanceof Error ? error.message : String(error),
        });
        this.handleComputeError(nodeId, error);
        throw error;
      }
    });
  }

  /**
   * Exports graph structure to serializable object
   * @param metadata Additional metadata to include in export
   * @returns Object with graph structure description
   */
  public exportGraph(
    metadata?: Readonly<Record<string, import('../types/utils').Serializable>>
  ): IGraphDefinition {
    return this.logger.measureTime('engine', 'export-graph', () => {
      this.logger.inputGuardWarn(`Exporting graph with ${this.defs.size} nodes`, true);

      const nodes: INodeDefinition[] = [];

      // Export all node definitions
      for (const nodeDef of this.defs.values()) {
        nodes.push({
          id: nodeDef.id,
          type: nodeDef.type,
          config: nodeDef.config ? JSON.parse(JSON.stringify(nodeDef.config)) : undefined,
          inputs: nodeDef.inputs ? [...nodeDef.inputs] : undefined,
          cacheOptions: nodeDef.cacheOptions ? { ...nodeDef.cacheOptions } : undefined,
        });
      }

      const result = {
        nodes,
        metadata: {
          version: '1.0',
          exportDate: new Date().toISOString(),
          nodesCount: nodes.length,
          ...metadata,
        },
      };

      this.logger.logEvent('engine', 'graph-exported', {
        nodesCount: nodes.length,
        metadataKeys: metadata ? Object.keys(metadata) : [],
      });

      return result;
    });
  }

  /**
   * Imports graph structure from serialized object
   * @param graphDef Graph definition
   * @param options Additional import options
   * @returns Array of added node identifiers
   */
  public importGraph(
    graphDef: IGraphDefinition,
    options: {
      checkCycles?: boolean;
      conflictStrategy?: 'skip' | 'replace' | 'throw';
    } = {}
  ): string[] {
    return this.logger.measureTime('engine', 'import-graph', () => {
      const { checkCycles = true, conflictStrategy = 'throw' } = options;

      this.logger.logEvent('engine', 'graph-import-start', {
        nodesCount: graphDef.nodes.length,
        strategy: conflictStrategy,
        checkCycles,
      });

      this.logger.inputGuardWarn(
        `Importing graph with ${graphDef.nodes.length} nodes (strategy: ${conflictStrategy})`,
        true
      );

      // Check availability of all node types
      const allNodeTypes = new Set<string>();
      for (const node of graphDef.nodes) {
        allNodeTypes.add(node.type);
      }

      // Check if all node types are registered
      const missingTypes: string[] = [];
      for (const nodeType of allNodeTypes) {
        try {
          this.registry.get(nodeType);
        } catch (error) {
          missingTypes.push(nodeType);
        }
      }

      if (missingTypes.length > 0) {
        const errorMessage = `Plugins not found for following node types: ${missingTypes.join(', ')}`;
        this.logger.logEvent('engine', 'import-missing-plugins', {
          missingTypes,
        });
        this.logger.inputGuardError(errorMessage);
        throw new Error(errorMessage);
      }

      // Determine order of node addition: first nodes without inputs
      const nodesWithoutInputs = graphDef.nodes.filter(
        node => !node.inputs || node.inputs.length === 0
      );
      const nodesWithInputs = graphDef.nodes.filter(node => node.inputs && node.inputs.length > 0);

      const orderedNodes = [...nodesWithoutInputs, ...nodesWithInputs];
      const addedNodeIds: string[] = [];
      const failedNodes: string[] = [];

      this.logger.logEvent('engine', 'import-ordered-nodes', {
        sourceNodesCount: nodesWithoutInputs.length,
        dependentNodesCount: nodesWithInputs.length,
      });

      // Add nodes in specific order
      for (const nodeDef of orderedNodes) {
        try {
          // Check if node with this ID exists
          const nodeExists = this.defs.has(nodeDef.id);

          if (nodeExists) {
            if (conflictStrategy === 'throw') {
              this.logger.logEvent('engine', 'import-node-conflict', {
                nodeId: nodeDef.id,
                action: 'throw',
              });
              throw new Error(`Node with ID '${nodeDef.id}' already exists`);
            } else if (conflictStrategy === 'skip') {
              this.logger.logEvent('engine', 'import-node-conflict', {
                nodeId: nodeDef.id,
                action: 'skip',
              });
              this.logger.inputGuardWarn(`Skipping existing node: ${nodeDef.id}`, true);
              continue;
            } else if (conflictStrategy === 'replace') {
              this.logger.logEvent('engine', 'import-node-conflict', {
                nodeId: nodeDef.id,
                action: 'replace',
              });
              this.logger.inputGuardWarn(`Replacing existing node: ${nodeDef.id}`, true);
              this.removeNode(nodeDef.id);
            }
          }

          // Check presence of all input nodes
          if (nodeDef.inputs && nodeDef.inputs.length > 0) {
            for (const inputId of nodeDef.inputs) {
              if (!this.defs.has(inputId) && !addedNodeIds.includes(inputId)) {
                this.logger.logEvent('engine', 'import-missing-input', {
                  nodeId: nodeDef.id,
                  missingInputId: inputId,
                });
                throw new Error(`Input node '${inputId}' not found for node '${nodeDef.id}'`);
              }
            }
          }

          // Add node
          this.addNode(nodeDef);
          addedNodeIds.push(nodeDef.id);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          this.logger.logEvent('engine', 'import-node-failed', {
            nodeId: nodeDef.id,
            type: nodeDef.type,
            error: errorMessage,
          });
          this.logger.inputGuardError(`Error importing node '${nodeDef.id}': ${errorMessage}`);
          failedNodes.push(nodeDef.id);

          // Don't continue if cycle check is enabled
          if (checkCycles) {
            throw error;
          }
        }
      }

      // Check for cycles after import (if required)
      if (checkCycles && addedNodeIds.length > 0) {
        for (const nodeId of addedNodeIds) {
          // If cycle detected, remove all added nodes and throw error
          if (this.detectCycle(nodeId)) {
            const errorMessage = `Cycle detected in imported graph. Node '${nodeId}' is part of cycle.`;

            this.logger.logEvent('engine', 'import-cycle-detected', {
              nodeId,
              nodesAdded: addedNodeIds.length,
            });

            this.logger.inputGuardError(errorMessage);

            // Remove all added nodes
            for (const id of addedNodeIds) {
              if (this.defs.has(id)) {
                this.removeNode(id);
              }
            }

            throw new Error(errorMessage);
          }
        }
      }

      if (failedNodes.length > 0) {
        this.logger.logEvent('engine', 'import-partial-success', {
          addedCount: addedNodeIds.length,
          failedCount: failedNodes.length,
          failedNodes,
        });
        this.logger.inputGuardWarn(
          `Failed to import following nodes: ${failedNodes.join(', ')}`,
          true
        );
      } else {
        this.logger.logEvent('engine', 'import-complete-success', {
          addedCount: addedNodeIds.length,
          totalCount: graphDef.nodes.length,
        });
      }

      this.logger.inputGuardWarn(
        `Successfully imported ${addedNodeIds.length} of ${graphDef.nodes.length} nodes`,
        true
      );
      return addedNodeIds;
    });
  }

  /**
   * Starts engine
   */
  start(): void {
    if (this.state !== EngineState.INITIALIZED && this.state !== EngineState.PAUSED) {
      const error = new Error(`Cannot start engine in state: ${this.state}`);
      this.logger.inputGuardError(error.message);
      throw error;
    }

    // 🧹 Clear errorHistoryLastExecution at start of each start (keep errorCount for cumulative statistics)
    this.reseterrorHistoryLastExecution();

    const previousState = this.state;
    this.state = EngineState.RUNNING;

    this.logger.logEvent('engine', 'start', {
      previousState,
      engineId: this.engineId,
      nodesCount: this.defs.size,
    });

    // If was paused, restore subscriptions
    if (previousState === EngineState.PAUSED) {
      this.logger.logEvent('engine', 'resuming-from-paused', {
        previousState,
        currentState: this.state,
      });
      this.resumeAllSubscriptions();
    } else if (previousState === EngineState.INITIALIZED) {
      // If first start - update start time and create subscriptions for all nodes
      this.logger.logEvent('engine', 'starting-from-initialized', {
        previousState,
        currentState: this.state,
      });
      this.startTime = Date.now();
      this.recreateNodeSubscriptions(); // Create subscriptions for all nodes
    }

    // Call hooks
    this.hookManager.emit(EngineEventType.ENGINE_STARTED, previousState);
    this.hookManager.emit(EngineEventType.ENGINE_STATE_CHANGED, previousState, this.state);
  }

  /**
   * Pauses engine
   */
  pause(): void {
    if (this.state !== EngineState.RUNNING) {
      const error = new Error(`Cannot pause engine in state: ${this.state}`);
      this.logger.inputGuardError(error.message);
      throw error;
    }

    const previousState = this.state;
    this.state = EngineState.PAUSED;

    // Pause subscriptions
    this.pauseAllSubscriptions();

    this.logger.logEvent('engine', 'pause', {
      engineId: this.engineId,
      nodesCount: this.defs.size,
      savedSubscriptions: this.pausedSubscriptions.size,
    });

    // Call hooks
    this.hookManager.emit(EngineEventType.ENGINE_PAUSED);
    this.hookManager.emit(EngineEventType.ENGINE_STATE_CHANGED, previousState, this.state);
  }

  /**
   * Resumes engine after pause
   */
  resume(): void {
    if (this.state !== EngineState.PAUSED) {
      const error = new Error(`Cannot resume engine in state: ${this.state}`);
      this.logger.inputGuardError(error.message);
      throw error;
    }

    const previousState = this.state;
    this.state = EngineState.RUNNING;

    // Restore subscriptions - this will also apply deferred updates
    this.resumeAllSubscriptions();

    this.logger.logEvent('engine', 'resume', {
      engineId: this.engineId,
      nodesCount: this.defs.size,
      restoredSubscriptions: this.pausedSubscriptions.size,
      pendingUpdates: this.nodesToUpdateOnResume.size,
    });

    // Call hooks
    this.hookManager.emit(EngineEventType.ENGINE_RESUMED);
    this.hookManager.emit(EngineEventType.ENGINE_STATE_CHANGED, previousState, this.state);
  }

  /**
   * Stops engine
   */
  stop(): void {
    if (this.state === EngineState.DESTROYED) {
      const error = new Error('Engine already destroyed');
      this.logger.inputGuardError(error.message);
      throw error;
    }

    const previousState = this.state;
    this.state = EngineState.STOPPING;

    if (this.hookManager.hasHandlers(EngineEventType.BEFORE_DESTROY)) {
      this.hookManager.emit(EngineEventType.BEFORE_DESTROY);
    }

    this.logger.logEvent('engine', 'stop', {
      engineId: this.engineId,
      previousState,
      nodesCount: this.defs.size,
    });

    // Cancel all subscriptions and tasks
    this.cancelAllSubscriptions();
    this.cancelAllTasks();

    // Clear statistics logging timer
    if (this.statLoggingInterval) {
      clearInterval(this.statLoggingInterval);
      this.statLoggingInterval = null;
    }

    this.state = EngineState.DESTROYED;

    if (this.hookManager.hasHandlers(EngineEventType.AFTER_DESTROY)) {
      this.hookManager.emit(EngineEventType.AFTER_DESTROY);
    }

    if (this.hookManager.hasHandlers(EngineEventType.ENGINE_STATE_CHANGED)) {
      this.hookManager.emit(EngineEventType.ENGINE_STATE_CHANGED, previousState, this.state);
    }
  }

  /**
   * Returns current engine state
   */
  getState(): EngineState {
    return this.state;
  }

  /**
   * Returns current engine statistics
   */
  getStats(): EngineStats {
    return this.collectEngineStats();
  }

  /**
   * Resets error counters and statistics
   */
  resetStats(): void {
    this.errorCount = 0;
    this.computeCount = 0;
    this.errorHistoryLastExecution = [];

    this.logger.logEvent('engine', 'stats-reset', {
      engineId: this.engineId,
    });
  }

  /**
   * Clears only error history (keeps errorCount for cumulative statistics)
   */
  reseterrorHistoryLastExecution(): void {
    this.errorHistoryLastExecution = [];

    this.logger.logEvent('engine', 'error-history-reset', {
      engineId: this.engineId,
      errorCountPreserved: this.errorCount,
    });
  }

  /**
   * Returns list of all node identifiers in graph
   */
  getNodeIds(): string[] {
    return Array.from(this.defs.keys());
  }

  /**
   * Cancels all subscriptions
   */
  private cancelAllSubscriptions(): void {
    // Cancel existing subscriptions
    for (const subscription of this.subscriptions.values()) {
      subscription.unsubscribe();
    }
    this.subscriptions.clear();

    // Cancel saved subscriptions
    for (const subscription of this.pausedSubscriptions.values()) {
      subscription.unsubscribe();
    }
    this.pausedSubscriptions.clear();
  }

  /**
   * Cancels all active tasks
   */
  private cancelAllTasks(): void {
    if (this.options.enableCancelableCompute) {
      for (const [nodeId, task] of this.activeComputations.entries()) {
        try {
          task.cancel();
          this.logger.logEvent('engine', 'task-cancelled', {
            nodeId,
            reason: 'engine-stop',
          });
        } catch (error) {
          const errorMessage = error instanceof Error ? error : new Error(String(error));
          this.logger.inputGuardError(`Error cancelling task: ${nodeId}`, errorMessage);
          this.logger.logEvent('engine', 'task-cancel-error', {
            nodeId,
            error: errorMessage.message,
          });
        }
      }
      this.activeComputations.clear();
    }

    // 🆕 Cleanup all active Promise tasks
    if (this.activePromiseTasks.size > 0) {
      this.logger.logEvent('engine', 'promise-tasks-cleanup', {
        taskCount: this.activePromiseTasks.size,
        reason: 'engine-stop',
      });
      this.activePromiseTasks.clear();
    }

    // 🆕 Cleanup deferred hooks
    if (this.pendingSkipComputationHooks.size > 0) {
      this.logger.logEvent('engine', 'pending-hooks-cleanup', {
        hookCount: this.pendingSkipComputationHooks.size,
        reason: 'engine-stop',
      });
      this.pendingSkipComputationHooks.clear();
    }
  }

  /**
   * Pauses all subscriptions
   */
  private pauseAllSubscriptions(): void {
    for (const [nodeId, subscription] of this.subscriptions.entries()) {
      this.pausedSubscriptions.set(nodeId, subscription);
      subscription.unsubscribe();
    }
    this.subscriptions.clear();

    this.logger.logEvent('engine', 'subscriptions-paused', {
      pausedCount: this.pausedSubscriptions.size,
    });
  }

  /**
   * Restores subscriptions after pause
   */
  private resumeAllSubscriptions(): void {
    // Recreate all subscriptions
    const createdCount = this.recreateNodeSubscriptions();

    this.logger.logEvent('engine', 'subscriptions-resumed', {
      createdCount,
      previouslyPaused: this.pausedSubscriptions.size,
    });

    this.pausedSubscriptions.clear();

    // Apply deferred updates after restoring subscriptions
    if (this.nodesToUpdateOnResume.size > 0) {
      const updates = [...this.nodesToUpdateOnResume.entries()];
      this.nodesToUpdateOnResume.clear();

      // Give small delay before applying updates
      setTimeout(() => {
        for (const [nodeId, nodeDef] of updates) {
          this.logger.logEvent('engine', 'apply-deferred-update', { nodeId });
          this.updateNode(nodeId, nodeDef);
        }
      }, 10);
    }
  }

  /**
   * Recreates subscriptions for all nodes
   * @returns Number of recreated subscriptions
   */
  private recreateNodeSubscriptions(): number {
    let createdCount = 0;

    for (const [nodeId, def] of this.defs.entries()) {
      this.recreateNodeSubscription(nodeId, def);
      createdCount++;
    }

    this.logger.logEvent('engine', 'subscriptions-recreated', {
      count: createdCount,
    });

    return createdCount;
  }

  /**
   * Recreates subscription for specific node
   */
  private recreateNodeSubscription(nodeId: string, def: INodeDefinition): void {
    const wrapper = this.wrappers.get(nodeId);
    const subject = this.subjects.get(nodeId);

    this.logger.logEvent('engine', 'recreating-subscription', {
      nodeId,
      hasWrapper: !!wrapper,
      hasSubject: !!subject,
      subjectValue: subject?.getValue() as import('../types/utils').Serializable,
      subjectValueType: typeof subject?.getValue(),
      inputsCount: def.inputs?.length ?? 0,
    });

    if (!wrapper || !subject) {
      this.logger.logEvent('engine', 'recreate-subscription-failed', {
        nodeId,
        hasWrapper: !!wrapper,
        hasSubject: !!subject,
      });
      return;
    }

    // 🔧 UPDATE config wrapper with subject for data nodes
    // Category comes from plugin, fallback to config for backward compatibility
    const plugin = this.registry.get(def.type);
    const category: NodeCategory | undefined =
      plugin.category ?? (def.config?.category as NodeCategory | undefined);
    if (category === 'data' && wrapper && 'config' in wrapper) {
      const wrapperWithConfig = wrapper as unknown as { config: Record<string, unknown> };
      wrapperWithConfig.config.__subject = subject;
      this.logger.logEvent('engine', 'wrapper-config-updated', {
        nodeId,
        type: def.type,
        category,
        hasSubject: !!wrapperWithConfig.config.__subject,
      });
    }

    // Create new destructor
    const destroy$ = new Subject<void>();
    this.nodeDestructors.set(nodeId, destroy$);

    const inputStreams = (def.inputs ?? []).map(
      inputId => this.subjects.get(inputId) ?? new BehaviorSubject<unknown>(INIT_NODE_EXEC)
    );

    // For nodes without inputs just execute computation
    if (inputStreams.length === 0) {
      try {
        // 🔧 INCREASE computeCount for data nodes without inputs
        this.computeCount++;

        const result = wrapper.compute([]);

        if (result instanceof Promise) {
          this.logger.logEvent('engine', 'promise-detected', {
            nodeId: nodeId,
            type: def.type,
          });

          // 🆕 Add Promise to active tasks tracking
          this.activePromiseTasks.set(nodeId, result);

          result
            .then(
              value => subject.next(value),
              error => {
                this.handleComputeError(nodeId, error);
                subject.next(null);
              }
            )
            .finally(() => {
              // 🆕 Remove Promise from tracking when it completes
              this.activePromiseTasks.delete(nodeId);
              this.logger.logEvent('engine', 'promise-completed', {
                nodeId: nodeId,
                type: def.type,
              });

              // 🆕 Check deferred hooks
              this.checkAndEmitPendingSkipComputationHooks();
            });
        } else {
          subject.next(result);
        }
      } catch (error) {
        // Safely handle compute error - wrap in try-catch to prevent error propagation
        try {
          this.handleComputeError(nodeId, error);
        } catch (handleError) {
          // If handleComputeError itself throws, log it but don't propagate
          this.logger.error('Error in handleComputeError', handleError);
        }
        subject.next(null);
      }
      return;
    }

    // Create processing pipeline
    let pipeline = combineLatest(inputStreams).pipe(
      takeUntil(this.destroy$),
      takeUntil(destroy$),
      skipWhile(values => values.includes(INIT_NODE_EXEC)), // Wait until all nodes are initialized
      mergeMap(values => Promise.all(values)) // Wait until all promises resolve
    );

    if (this.options.debounceTime && this.options.debounceTime > 0) {
      pipeline = pipeline.pipe(debounceTime(this.options.debounceTime));
    }

    if (this.options.throttleTime && this.options.throttleTime > 0) {
      pipeline = pipeline.pipe(throttleTime(this.options.throttleTime));
    }

    if (this.options.distinctValues) {
      pipeline = pipeline.pipe(
        distinctUntilChanged((prev, curr) => JSON.stringify(prev) === JSON.stringify(curr))
      );
    }

    // Compute processing and subscription
    pipeline = pipeline.pipe(
      mergeMap(values => {
        try {
          this.computeCount++;

          // Cancel previous task
          if (this.options.enableCancelableCompute) {
            const currentTask = this.activeComputations.get(nodeId);
            if (currentTask) {
              try {
                currentTask.cancel();
              } catch (error) {
                const errorMessage = error instanceof Error ? error : new Error(String(error));
                this.logger.inputGuardError(`Error cancelling task: ${nodeId}`, errorMessage);
              }
            }
            this.activeComputations.delete(nodeId);
          }

          const result = wrapper.compute(values);

          if (this.options.enableCancelableCompute && isCancelableComputation(result)) {
            if (result.cancel) {
              this.activeComputations.set(nodeId, { cancel: result.cancel });
            }

            return from(result.promise).pipe(
              catchError(error => {
                this.handleComputeError(nodeId, error);
                return from([null]);
              })
            );
          }

          if (result instanceof Promise) {
            this.logger.logEvent('engine', 'promise-detected', {
              nodeId: nodeId,
              type: def.type,
            });

            // 🆕 Add Promise to active tasks tracking
            this.activePromiseTasks.set(nodeId, result);

            return from(result).pipe(
              catchError(error => {
                this.logger.logEvent('engine', 'promise-rejected', {
                  nodeId: nodeId,
                  error: error instanceof Error ? error.message : String(error),
                });
                this.handleComputeError(nodeId, error);
                return from([null]);
              }),
              // 🆕 Remove Promise from tracking when it completes
              finalize(() => {
                this.activePromiseTasks.delete(nodeId);
                this.logger.logEvent('engine', 'promise-completed', {
                  nodeId: nodeId,
                  type: def.type,
                });

                // 🆕 Check deferred hooks
                this.checkAndEmitPendingSkipComputationHooks();
              })
            );
          }

          return from([result]);
        } catch (error) {
          this.handleComputeError(nodeId, error);
          return from([null]);
        }
      })
    );

    // Subscribe and store
    const sub = pipeline.subscribe(result => {
      subject.next(result);
    });

    this.subscriptions.set(nodeId, sub);
  }

  /**
   * Collects current engine statistics
   */
  private collectEngineStats(): EngineStats {
    const memUsage = this.environmentAdapter.getMemoryUsage();

    // Count internal engine subscriptions
    const internalSubscriptions = this.subscriptions.size;

    // Count external subscriptions to nodes
    const externalSubscriptions = this.externalSubscriptionsCount;

    let activeDataNodes = 0;
    for (const [, def] of this.defs.entries()) {
      // Category comes from plugin, fallback to config for backward compatibility
      const plugin = this.registry.get(def.type);
      const category: NodeCategory | undefined =
        plugin.category ?? (def.config?.category as NodeCategory | undefined);
      if (category === 'data' && def.config?.isSubscribed === true) {
        activeDataNodes++;
      }
    }

    const totalSubscriptions = internalSubscriptions + externalSubscriptions + activeDataNodes;

    // 🆕 Account for both cancelable and Promise tasks
    const totalActiveTasks = this.activeComputations.size + this.activePromiseTasks.size;

    return {
      timestamp: Date.now(),
      state: this.state,
      nodesCount: this.defs.size,
      activeSubscriptions: totalSubscriptions,
      activeTasks: totalActiveTasks,
      pendingHooks: this.pendingSkipComputationHooks.size,
      errorCount: this.errorCount,
      computeCount: this.computeCount,
      memoryUsage: {
        heapUsed: memUsage.heapUsed,
        heapTotal: memUsage.heapTotal,
        external: memUsage.external,
        rss: memUsage.rss,
      },
      uptime: Date.now() - this.startTime,
      cacheStats: this.cacheProvider?.getStats() || null,
      errorHistoryLastExecution: [...this.errorHistoryLastExecution], // 🆕 Add error history to statistics (only for getStats, NOT for state saving)
    };
  }

  /**
   * Collects memory usage statistics
   */
  private collectMemoryStats(): EngineMemoryStats {
    const memUsage = this.environmentAdapter.getMemoryUsage();

    return {
      heapUsed: memUsage.heapUsed,
      heapTotal: memUsage.heapTotal,
      external: memUsage.external,
      rss: memUsage.rss,
    };
  }

  /**
   * Sets up periodic statistics logging
   */
  private setupStatsLogging(): void {
    // Clear previous timer if it exists
    if (this.statLoggingInterval) {
      clearInterval(this.statLoggingInterval);
      this.statLoggingInterval = null;
    }

    if (this.options.statLoggingInterval && this.options.statLoggingInterval > 0) {
      this.statLoggingInterval = setInterval(() => {
        if (this.state === EngineState.RUNNING) {
          const stats = this.collectEngineStats();

          this.logger.logEvent(
            'engine',
            'periodic-stats',
            stats as unknown as Readonly<Record<string, import('../types/utils').Serializable>>
          );

          // Fix HEALTH_CHECK hook call
          if (this.hookManager.hasHandlers(EngineEventType.HEALTH_CHECK)) {
            const memoryStats = this.collectMemoryStats();
            this.hookManager.emit(EngineEventType.HEALTH_CHECK, {
              engineId: this.engineId,
              stats,
              memory: memoryStats,
              state: this.state,
            });
          }

          // Check threshold values
          this.checkErrorThreshold();
          this.checkMemoryThreshold();
        }
      }, this.options.statLoggingInterval);

      // Register exit handler to clear timer
      this.exitHandlerUnsubscribe = this.environmentAdapter.onExit(() => {
        if (this.statLoggingInterval) {
          clearInterval(this.statLoggingInterval);
          this.statLoggingInterval = null;
        }
      });
    }
  }

  /**
   * Checks if error threshold is exceeded
   */
  private checkErrorThreshold(): void {
    if (!this.options.errorThreshold) return;

    const timeWindow = this.options.errorTimeWindow ?? 60000; // Default 1 minute
    const now = Date.now();
    const recentErrors = this.errorHistoryLastExecution.filter(e => now - e.timestamp < timeWindow);

    if (recentErrors.length >= this.options.errorThreshold) {
      this.logger.logEvent('engine', 'error-threshold-exceeded', {
        errorCount: recentErrors.length,
        threshold: this.options.errorThreshold,
        timeWindow,
      });

      // Fix ERROR_THRESHOLD_EXCEEDED hook call
      if (this.hookManager.hasHandlers(EngineEventType.ERROR_THRESHOLD_EXCEEDED)) {
        this.hookManager.emit(EngineEventType.ERROR_THRESHOLD_EXCEEDED, {
          errorCount: recentErrors.length,
          threshold: this.options.errorThreshold,
          timeWindowMs: timeWindow,
        });
      }
    }
  }

  /**
   * Checks if memory usage threshold is exceeded
   */
  private checkMemoryThreshold(): void {
    if (!this.options.memoryThreshold) return;

    const memoryUsage = this.environmentAdapter.getMemoryUsage().heapUsed;

    if (memoryUsage > this.options.memoryThreshold) {
      this.logger.logEvent('engine', 'memory-threshold-exceeded', {
        memoryUsage,
        threshold: this.options.memoryThreshold,
        mbUsed: Math.round((memoryUsage / 1024 / 1024) * 100) / 100,
      });

      // Fix MEMORY_THRESHOLD_EXCEEDED hook call
      if (this.hookManager.hasHandlers(EngineEventType.MEMORY_THRESHOLD_EXCEEDED)) {
        this.hookManager.emit(EngineEventType.MEMORY_THRESHOLD_EXCEEDED, {
          usedMemory: memoryUsage,
          threshold: this.options.memoryThreshold,
          memoryLimit: undefined, // Can be added if memory limit data is available
        });
      }
    }
  }

  /**
   * Exports full engine state for serialization
   * @param includeMetadata Whether to include additional metadata
   * @returns Serializable state object
   */
  public exportState(includeMetadata = false): EngineStateSnapshot {
    this.logger.logEvent('engine', 'state-export-started', {
      engineId: this.engineId,
      nodeCount: this.defs.size,
      includeMetadata,
    });

    // Collect node states
    const nodes: Record<string, NodeState> = {};

    for (const [nodeId, nodeDef] of this.defs.entries()) {
      const subject = this.subjects.get(nodeId);
      if (!subject) continue;

      // Save cache state for this node
      const nodeCacheData = this.cacheProvider.exportNodeCache?.(nodeId) as unknown;

      // Clear runtime fields from config with safe serialization
      let cleanConfig: NodeConfig | undefined = undefined;
      if (nodeDef.config) {
        try {
          // First clear runtime fields
          const strippedConfig = stripRuntimeFields(nodeDef.config);
          // Then safely serialize
          cleanConfig = JSON.parse(JSON.stringify(strippedConfig));
        } catch (error) {
          // If serialization failed due to circular references,
          // use stripRuntimeFields to create copy without problematic fields
          cleanConfig = stripRuntimeFields(nodeDef.config);
        }
      }

      // Create state object for node
      const nodeState: NodeState = {
        id: nodeId,
        type: nodeDef.type,
        inputs: nodeDef.inputs ?? [],
        config: cleanConfig,
        currentValue: serializeValue(subject.getValue()), // Convert Symbol to strings
        errorCount: 0, // Get from node if available
        cacheData: nodeCacheData,
      };

      nodes[nodeId] = nodeState;
    }

    // Collect statistics
    const stats = this.getStats();

    // Collect metadata if needed
    const metadata: Record<string, unknown> = {};
    if (includeMetadata) {
      metadata.exportTime = new Date().toISOString();
      metadata.nodeTypes = [...new Set(Object.values(nodes).map(n => n.type))];
      metadata.externalSubscriptionsCount = this.externalSubscriptionsCount;
      metadata.version = '1.0'; // Export format version
    }

    // Create state object with safe serialization
    // Always export state as STOPPED for correct import
    const stateSnapshot: EngineStateSnapshot = {
      engineId: this.engineId,
      createdAt: this.startTime,
      exportedAt: Date.now(),
      state: EngineState.INITIALIZED, // Always export as INITIALIZED for correct import
      options: { ...this.options },
      stats,
      nodes,
      metadata: includeMetadata
        ? (metadata as Readonly<Record<string, import('../types/utils').Serializable>>)
        : undefined,
    };

    // Check if state can be serialized
    try {
      JSON.stringify(stateSnapshot);
    } catch (error) {
      this.logger.logEvent('engine', 'state-export-warning', {
        engineId: this.engineId,
        error: 'Circular reference detected, using fallback serialization',
      });

      // If there are circular references, create simplified version
      const fallbackSnapshot: EngineStateSnapshot = {
        engineId: this.engineId,
        createdAt: this.startTime,
        exportedAt: Date.now(),
        state: EngineState.INITIALIZED, // Always export as INITIALIZED
        options: { ...this.options },
        stats: {
          ...stats,
          // Remove fields that may contain circular references
          errorHistoryLastExecution: [],
        },
        nodes,
        metadata: includeMetadata
          ? (metadata as Readonly<Record<string, import('../types/utils').Serializable>>)
          : undefined,
      };

      return fallbackSnapshot;
    }

    this.logger.logEvent('engine', 'state-exported', {
      engineId: this.engineId,
      nodeCount: Object.keys(nodes).length,
      state: this.state,
      exportedAt: stateSnapshot.exportedAt,
    });

    return stateSnapshot;
  }

  /**
   * Imports full engine state from serialized object
   * @param state Serialized state
   * @param options Import options
   * @returns Promise that resolves when state is imported
   */
  public async importState(
    state: EngineStateSnapshot,
    options: {
      preserveOptions?: boolean;
      validateTypes?: boolean;
    } = {}
  ): Promise<void> {
    const { preserveOptions = true, validateTypes = true } = options;

    // Check that engine is not destroyed
    if (this.state === EngineState.DESTROYED) {
      throw new Error('Cannot import state into destroyed engine');
    }

    this.logger.logEvent('engine', 'state-import-started', {
      engineId: state.engineId,
      nodesCount: Object.keys(state.nodes).length,
      importState: state.state,
      currentState: this.state,
    });

    // Save current engine state
    const currentState = this.state;

    // If engine is currently running, stop it first
    if (currentState === EngineState.RUNNING) {
      this.pause();
    }

    try {
      // Clear current state, preserving options if needed
      this.clearAllData(preserveOptions);

      // Restore basic properties (use cast to bypass readonly)
      (this as unknown as { engineId: string }).engineId = state.engineId;
      this.startTime = state.createdAt;

      // Restore options if not preserving current ones
      if (!preserveOptions) {
        (this as unknown as { options: IEngineOptions }).options = { ...state.options };
      }

      // Restore statistics
      this.computeCount = state.stats?.computeCount ?? 0;
      this.errorCount = state.stats?.errorCount ?? 0;

      if (state.stats?.errorHistoryLastExecution) {
        this.errorHistoryLastExecution = [...state.stats.errorHistoryLastExecution];
      }

      // Create nodes in correct order (first without input data)
      const nodeIds = Object.keys(state.nodes);

      // First nodes without inputs
      const nodesWithoutInputs = nodeIds.filter(
        id => !state.nodes[id]?.inputs || state.nodes[id]?.inputs.length === 0
      );

      // Then other nodes
      const nodesWithInputs = nodeIds.filter(
        id => state.nodes[id]?.inputs && (state.nodes[id]?.inputs.length ?? 0) > 0
      );

      // Create nodes without computing their values
      const orderedNodes = [...nodesWithoutInputs, ...nodesWithInputs];

      for (const nodeId of orderedNodes) {
        const nodeState = state.nodes[nodeId];

        // Skip if nodeState is undefined
        if (!nodeState) {
          this.logger.logEvent('engine', 'import-node-skip', {
            nodeId,
            reason: 'Node state not found',
          });
          continue;
        }

        // Check that node type is registered
        if (validateTypes) {
          try {
            this.registry.get(nodeState.type);
          } catch (error) {
            this.logger.logEvent('engine', 'import-node-error', {
              nodeId,
              type: nodeState.type,
              error: 'Plugin not found',
            });
            throw new Error(`Plugin for node type '${nodeState.type}' not found`);
          }
        }

        // Create node definition
        const nodeDef: INodeDefinition = {
          id: nodeState.id,
          type: nodeState.type,
          inputs: [...nodeState.inputs],
          config: nodeState.config ? JSON.parse(JSON.stringify(nodeState.config)) : undefined,
        };

        // Add node without computation
        this.addNodeWithoutCompute(nodeDef);

        // Restore cache for node if it exists
        if (nodeState.cacheData && this.cacheProvider.importNodeCache) {
          await this.cacheProvider.importNodeCache(nodeId, nodeState.cacheData as never);
        }

        // Restore node value if it exists
        if (nodeState.currentValue !== undefined) {
          const subject = this.subjects.get(nodeId);
          if (subject) {
            // Convert strings back to Symbol values
            const restoredValue = deserializeValue(nodeState.currentValue);

            this.logger.logEvent('engine', 'state-value-restored', {
              nodeId,
              value: restoredValue as import('../types/utils').Serializable,
              valueType: typeof restoredValue,
              isINIT_NODE_EXEC: restoredValue === INIT_NODE_EXEC,
              isSKIP_NODE_EXEC: restoredValue === SKIP_NODE_EXEC,
            });
            subject.next(restoredValue);
          } else {
            this.logger.logEvent('engine', 'state-restore-warning', {
              nodeId,
              error: 'Subject not found during state restoration',
            });
          }
        } else {
          this.logger.logEvent('engine', 'state-no-value', {
            nodeId,
            reason: 'currentValue is undefined',
          });
        }
      }

      // Set engine state
      if (state.state === EngineState.RUNNING) {
        // If imported state was RUNNING, start engine
        this.start();
      } else {
        // Otherwise set imported state
        this.state = state.state;
      }

      this.logger.logEvent('engine', 'state-imported', {
        engineId: this.engineId,
        nodesRestored: orderedNodes.length,
        currentState: this.state,
      });

      // Notify about restoration
      if (this.hookManager.hasHandlers(EngineEventType.ENGINE_RESTORED)) {
        this.hookManager.emit(EngineEventType.ENGINE_RESTORED, {
          engineId: this.engineId,
          nodeCount: this.defs.size,
          previousState: currentState,
          currentState: this.state,
        });
      }
    } catch (error) {
      // On error restore previous state
      this.state = currentState;

      this.logger.logEvent('engine', 'state-import-failed', {
        error: error instanceof Error ? error.message : String(error),
      });

      throw error;
    }
  }

  /**
   * Clears all engine data, optionally preserving settings
   */
  private clearAllData(preserveOptions = true): void {
    const savedOptions = preserveOptions ? { ...this.options } : undefined;

    // Cancel all subscriptions
    this.cancelAllSubscriptions();

    // Cancel active tasks
    this.cancelAllTasks();

    // Cleanup nodes
    for (const nodeId of this.defs.keys()) {
      this.cleanupNode(nodeId, false);
    }

    // Clear all collections
    this.defs.clear();
    this.wrappers.clear();
    this.subjects.clear();
    this.subscriptions.clear();
    this.pausedSubscriptions.clear();
    this.nodeDestructors.clear();
    this.nodesToUpdateOnResume.clear();

    // Reset counters
    this.computeCount = 0;
    this.errorCount = 0;
    this.errorHistoryLastExecution = [];

    // Restore settings if needed
    if (preserveOptions && savedOptions) {
      (this as unknown as { options: IEngineOptions }).options = savedOptions;
    }
  }

  /**
   * Creates node without starting computations
   * @param def Node definition
   */
  private addNodeWithoutCompute(def: INodeDefinition): void {
    const sanitizedDef = this.validateAndSanitizeNode(def);

    if (this.defs.has(sanitizedDef.id)) {
      this.logger.logEvent('engine', 'node-already-exists', { nodeId: sanitizedDef.id });
      throw new Error(`Node with id '${sanitizedDef.id}' already exists.`);
    }

    this.defs.set(sanitizedDef.id, sanitizedDef);

    const plugin = this.registry.get(sanitizedDef.type);

    // Create wrapper with execution context
    const wrapper = createNodeWrapper(
      plugin,
      sanitizedDef.config ?? {},
      this.options.executionMode === EngineExecutionMode.PARALLEL
        ? this.executionContext
        : undefined
    );

    const subject = new BehaviorSubject<unknown>(INIT_NODE_EXEC);
    this.logger.logEvent('engine', 'subject-created', {
      nodeId: sanitizedDef.id,
      initialValue: 'INIT_NODE_EXEC',
    });

    // 🔧 ADD subject to config wrapper for data nodes
    // Category comes from plugin, fallback to config for backward compatibility
    const category: NodeCategory | undefined =
      plugin.category ?? (sanitizedDef.config?.category as NodeCategory | undefined);
    if (category === 'data' && wrapper && 'config' in wrapper) {
      const wrapperWithConfig = wrapper as unknown as { config: Record<string, unknown> };
      wrapperWithConfig.config.__subject = subject;
      this.logger.logEvent('engine', 'wrapper-config-initialized', {
        nodeId: sanitizedDef.id,
        type: sanitizedDef.type,
        category,
        hasSubject: !!wrapperWithConfig.config.__subject,
      });
    }

    // Set cache options for node if specified
    if (sanitizedDef.cacheOptions) {
      this.cacheProvider.setNodeOptions(sanitizedDef.id, sanitizedDef.cacheOptions);
    }

    // Store wrapper and subject
    this.wrappers.set(sanitizedDef.id, wrapper);
    this.subjects.set(sanitizedDef.id, subject);

    // Create destructor
    const destroy$ = new Subject<void>();
    this.nodeDestructors.set(sanitizedDef.id, destroy$);

    this.logger.logEvent('engine', 'node-added-without-compute', {
      nodeId: sanitizedDef.id,
      type: sanitizedDef.type,
      inputsCount: (sanitizedDef.inputs ?? []).length,
    });
  }

  /**
   * Emits NODE_SKIP_COMPUTATION hook if there are no active Promise tasks
   * Otherwise saves hook for deferred emission
   */
  private emitSkipComputationHookIfReady(nodeId: string): void {
    if (this.activePromiseTasks.size === 0) {
      // No active Promises - emit hook immediately
      this.hookManager.emit(EngineEventType.NODE_SKIP_COMPUTATION, nodeId);
      this.logger.logEvent('engine', 'node-skip-computation', {
        nodeId,
        engineState: this.state,
        activeTasks: 0,
      });
    } else {
      // Active Promises exist - save for deferred emission
      this.pendingSkipComputationHooks.add(nodeId);
      this.logger.logEvent('engine', 'node-skip-computation-deferred', {
        nodeId,
        engineState: this.state,
        activeTasks: this.activePromiseTasks.size,
      });
    }
  }

  /**
   * Checks and emits deferred NODE_SKIP_COMPUTATION hooks
   * Called when Promise completes
   */
  private checkAndEmitPendingSkipComputationHooks(): void {
    if (this.activePromiseTasks.size === 0 && this.pendingSkipComputationHooks.size > 0) {
      // All Promises completed - emit deferred hooks
      const nodeIds = Array.from(this.pendingSkipComputationHooks);
      this.pendingSkipComputationHooks.clear();

      // Emit hook for each node
      nodeIds.forEach(nodeId => {
        this.hookManager.emit(EngineEventType.NODE_SKIP_COMPUTATION, nodeId);
        this.logger.logEvent('engine', 'node-skip-computation', {
          nodeId,
          engineState: this.state,
          activeTasks: 0,
          wasDeferred: true,
        });
      });
    }
  }
}
