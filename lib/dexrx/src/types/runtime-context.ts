import type { DataNodesExecutionMode } from './engine-options';
import type { NodeCategory } from './node-plugin';

/**
 * Runtime context added to node config by withRuntimeContext operator
 * This context is automatically injected into each node's config as __runtime field
 */
export interface IRuntimeContext {
  /**
   * Node identifier
   */
  readonly nodeId?: string;

  /**
   * Work unit identifier (e.g., tenant:anb)
   */
  readonly workUnitId?: string;

  /**
   * User identifier
   */
  readonly userId?: string;

  /**
   * Node category - 'data' or 'operational'
   * Note: Category is typically determined from plugin definition, but can be overridden in runtime context
   */
  readonly category?: NodeCategory;

  /**
   * Message identifier for this computation
   */
  readonly messageId?: string;

  /**
   * ID of the node that triggered this computation (for ASYNC_EXEC_MODE)
   */
  readonly triggeredNodeId?: string | null;

  /**
   * Data nodes execution mode (SYNC_EXEC_MODE or ASYNC_EXEC_MODE)
   * Automatically added from graph context by withRuntimeContext operator
   */
  readonly dataNodesExecutionMode?: DataNodesExecutionMode;

  /**
   * Email deduplication: messageId for which email was already sent
   */
  readonly emailSentForMessageId?: string;

  /**
   * Actions execution counters (for condition node)
   */
  readonly actionsExecuted?: {
    readonly ifAction?: number;
    readonly elseAction?: number;
  };

  /**
   * Last execution timestamps (for condition node)
   */
  readonly lastExecutionTime?: {
    readonly ifAction?: number | null;
    readonly elseAction?: number | null;
  };

  /**
   * Notifications metadata (for condition node)
   */
  readonly notifications?: {
    readonly sent?: {
      readonly ifAction?: number;
      readonly elseAction?: number;
    };
    readonly lastSent?: {
      readonly ifAction?: number | null;
      readonly elseAction?: number | null;
    };
    readonly emails?: {
      readonly ifAction?: number;
      readonly elseAction?: number;
    };
  };

  /**
   * Runtime context version (for migration purposes)
   */
  readonly version?: string;
}
