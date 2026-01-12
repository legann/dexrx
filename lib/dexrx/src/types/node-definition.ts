import { NodeCacheOptions } from './cache-types';
import { NodeConfig } from './utils';

/**
 * Definition of a node in the computation graph
 */
export interface INodeDefinition {
  readonly id: string;
  readonly type: string;
  readonly config?: NodeConfig;
  readonly inputs?: readonly string[];
  readonly cacheOptions?: NodeCacheOptions;
}
