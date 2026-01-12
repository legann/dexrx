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
  readonly metadata?: Readonly<Record<string, Serializable>>;
}
