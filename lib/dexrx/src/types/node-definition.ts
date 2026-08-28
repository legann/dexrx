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
  /**
   * Control-channel targets owned by this node (the controller).
   *
   * When this node emits a plain-object payload, the engine writes it into the
   * control-slot of every listed target (broadcast). A payload of the shape
   * `{ __targets: { targetId: delta } }` addresses each listed target with its
   * own delta instead; addressing is confined to this list. The write does NOT
   * trigger the target; the target overlays its slot on `def.config` on its next
   * compute. Control links are not data edges: they are invisible to cycle
   * detection, so a downstream controller may point back at an upstream target.
   *
   * Declaring `controls` (even as an empty array) also injects `config.__setControl`
   * for imperative pushes to dynamic targets.
   */
  readonly controls?: readonly string[];
}
