import { EngineState } from './engine-state';
import { EngineStats } from './engine-stats';
import { NodeConfig, NodeValue, Serializable } from './utils';

/**
 * Structure for storing node state during serialization
 */
export interface NodeState {
  readonly id: string;
  readonly type: string;
  readonly inputs: readonly string[];
  readonly controls?: readonly string[];
  readonly config?: NodeConfig;
  readonly currentValue?: NodeValue;
  readonly lastComputeTime?: number;
  readonly errorCount?: number;
  readonly cacheData?: unknown; // Can be any serializable format from cache provider
}

/**
 * Complete engine state for serialization
 * Used by Build API for state persistence and restoration
 */
export interface EngineStateSnapshot {
  readonly engineId: string;
  readonly createdAt: number;
  readonly exportedAt: number;
  readonly state: EngineState;
  readonly options: Readonly<Record<string, unknown>>;
  readonly stats: EngineStats;
  readonly nodes: Readonly<Record<string, NodeState>>;
  /**
   * Control-channel slots at export time (target id -> merged delta). Restored
   * directly on import: with addressed routing the controller's last payload may
   * cover only a subset of targets, so replaying it alone would lose slots.
   */
  readonly controlSlots?: Readonly<Record<string, NodeConfig>>;
  readonly metadata?: Readonly<Record<string, Serializable>>;
}
