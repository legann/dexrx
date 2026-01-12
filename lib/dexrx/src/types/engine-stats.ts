import { EngineState } from './engine-state';
import { CacheStats } from './cache-types';

/**
 * Information about memory usage by engine
 */
export interface EngineMemoryStats {
  /**
   * Number of bytes used in heap for active data
   */
  heapUsed: number;

  /**
   * Total heap size in bytes
   */
  heapTotal: number;

  /**
   * Memory used by external resources (e.g., C++ buffers)
   */
  external: number;

  /**
   * Total process size in memory (Resident Set Size)
   */
  rss: number;
}

/**
 * Entry in error history
 */
export interface errorHistoryLastExecutionEntry {
  timestamp: number;
  nodeId: string;
  message: string;
}

/**
 * Entry in computation history
 */
export interface ComputeHistoryEntry {
  timestamp: number;
  nodeId: string;
  durationMs: number;
}

/**
 * Comprehensive statistics about engine state for monitoring
 */
export interface EngineStats {
  /**
   * Timestamp of statistics collection
   */
  timestamp: number;

  /**
   * Current engine state
   */
  state: EngineState;

  /**
   * Number of nodes in graph
   */
  nodesCount: number;

  /**
   * Number of active subscriptions
   */
  activeSubscriptions: number;

  /**
   * Number of active tasks
   */
  activeTasks: number;

  /**
   * Number of deferred NODE_SKIP_COMPUTATION hooks
   */
  pendingHooks: number;

  /**
   * Number of computation errors since startup or counter reset
   */
  errorCount: number;

  /**
   * Total number of computations performed since startup
   */
  computeCount: number;

  /**
   * Memory usage statistics
   */
  memoryUsage: EngineMemoryStats;

  /**
   * Engine uptime in milliseconds
   */
  uptime: number;

  /**
   * Cache usage statistics, if enabled
   */
  cacheStats: CacheStats | null;

  /**
   * Error history
   */
  errorHistoryLastExecution?: errorHistoryLastExecutionEntry[];

  /**
   * Computation history
   */
  computeHistory?: ComputeHistoryEntry[];

  /**
   * Node statistics by type
   */
  nodeTypeStats?: Record<string, number>;
}
