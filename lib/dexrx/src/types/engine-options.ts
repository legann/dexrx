import { ICacheProvider, CacheInvalidationStrategy } from './cache-types';
import { ExecutionContext, ParallelExecutionOptions } from './execution-context';
import { ILogger } from './logger';
import { IInputGuardService } from './input-guard';
import { IEnvironmentAdapter } from '../utils/environment';

/**
 * Data nodes execution mode - controls how data nodes execute
 */
export enum DataNodesExecutionMode {
  ASYNC_EXEC_MODE = 'ASYNC_EXEC_MODE',
  SYNC_EXEC_MODE = 'SYNC_EXEC_MODE',
}

/**
 * Engine execution mode - controls overall engine execution strategy
 */
export enum EngineExecutionMode {
  SERIAL = 'serial',
  PARALLEL = 'parallel',
}

/**
 * Options for engine initialization
 */
export interface IEngineOptions {
  /**
   * Main logger
   */
  logger?: ILogger;

  /**
   * Input data validation service
   */
  inputGuardService?: IInputGuardService;

  /**
   * Enable deduplication of identical values
   */
  distinctValues?: boolean;

  /**
   * Debounce delay time (ms)
   */
  debounceTime?: number;

  /**
   * Minimum interval between recalculations (if throttling enabled)
   */
  throttleTime?: number;

  /**
   * Allow cancellation of previous computing task
   */
  enableCancelableCompute?: boolean;

  /**
   * Maximum depth for object sanitization
   */
  maxDepth?: number;

  /**
   * Execution mode: sequential or parallel
   */
  executionMode?: EngineExecutionMode;

  /**
   * Execution context
   */
  executionContext?: ExecutionContext;

  /**
   * Options for parallel execution
   */
  parallelOptions?: ParallelExecutionOptions;

  /**
   * Suppress error output to console
   */
  silentErrors?: boolean;

  /**
   * Perform input data sanitization
   */
  sanitizeInput?: boolean;

  /**
   * Caching options
   */
  cacheOptions?: {
    /**
     * Enable caching
     */
    enabled?: boolean;

    /**
     * Default cache time-to-live (ms)
     */
    defaultTtl?: number;

    /**
     * Maximum cache size
     */
    maxSize?: number;

    /**
     * Cache provider (for dependency inversion)
     */
    provider?: ICacheProvider;

    /**
     * Collect cache metrics
     */
    collectMetrics?: boolean;

    /**
     * Default cache invalidation strategy
     */
    defaultInvalidationStrategy?: CacheInvalidationStrategy | CacheInvalidationStrategy[];
  };

  /**
   * Statistics collection and logging interval in milliseconds
   * If not specified or <= 0, periodic logging is disabled
   */
  statLoggingInterval?: number;

  /**
   * Memory usage threshold in bytes, when exceeded
   * onMemoryThresholdExceeded hook is called
   */
  memoryThreshold?: number;

  /**
   * Maximum allowed number of errors in specified time interval
   */
  errorThreshold?: number;

  /**
   * Time window for error counting in milliseconds (default 60000 - 1 minute)
   */
  errorTimeWindow?: number;

  /**
   * Auto-start engine after initialization
   * If true or not specified, start() is called immediately after creation
   * Set to false to require explicit start() call
   */
  autoStart?: boolean;

  /**
   * Unique engine instance identifier
   * If not specified, generated automatically
   */
  engineId?: string;

  /**
   * Environment adapter for cross-platform work
   */
  environmentAdapter?: IEnvironmentAdapter;

  /**
   * Data nodes execution mode
   * ASYNC_EXEC_MODE - only triggered data node executes (default)
   * SYNC_EXEC_MODE - all data nodes execute regardless of trigger
   */
  dataNodesExecutionMode?: DataNodesExecutionMode;
}
