import { INodeDefinition } from './node-definition';
import { Serializable } from './utils';

/**
 * Graph definition for serialization and export
 */
export interface IGraphDefinition {
  readonly nodes: readonly INodeDefinition[];
  readonly metadata?: {
    readonly version?: string;
    readonly description?: string;
    readonly [key: string]: Serializable;
  };
}
