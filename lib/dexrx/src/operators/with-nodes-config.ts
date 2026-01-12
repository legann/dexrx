import type { GraphOperator, SubscriptionConfig } from '../graph';
import type { INodePlugin } from '../types/node-plugin';
import type { INodeDefinition } from '../types/node-definition';
import { withNodePlugins } from './plugins';
import { withNodes } from './with-nodes';
import { withSubscription } from './with-subscription';

/**
 * Unified configuration for nodes, plugins, and subscriptions
 * Ensures correct composition order internally: plugins → nodes → subscriptions
 * This eliminates order dependencies in createGraph()
 *
 * @param config - Nodes configuration object
 * @throws Error if config is empty or invalid
 *
 * @example
 * ```typescript
 * const graph = createGraph(
 *   withOptions({...}),
 *   withNodesConfig({
 *     nodesPlugins: [fetchPlugin, mathPlugin],
 *     nodes: [
 *       { id: 'fetch1', type: 'fetch', config: { url: '...' } },
 *       { id: 'math1', type: 'math', inputs: ['fetch1'], config: { isSubscribed: true } }
 *     ],
 *     subscriptions: {
 *       math1: (value) => console.log('Result:', value)
 *     }
 *   })
 * );
 * ```
 */
export interface NodesConfig {
  /**
   * Node plugins to register
   * Must be provided if nodes are specified
   */
  nodesPlugins?: INodePlugin[];

  /**
   * Node definitions to add to the graph
   * Requires plugins to be registered first
   */
  nodes?: INodeDefinition[];

  /**
   * Subscription configuration for subscribed nodes
   * Requires nodes to be added first
   */
  subscriptions?: SubscriptionConfig;
}

/**
 * Unified operator for nodes configuration
 * Applies plugins, nodes, and subscriptions in the correct order
 */
export function withNodesConfig(config: NodesConfig): GraphOperator {
  // Validation
  if (!config || typeof config !== 'object') {
    throw new Error('withNodesConfig: config must be an object');
  }

  const hasPlugins = config.nodesPlugins !== undefined && config.nodesPlugins !== null;
  const hasNodes = config.nodes !== undefined && config.nodes !== null;
  const hasSubscriptions = config.subscriptions !== undefined && config.subscriptions !== null;

  if (!hasPlugins && !hasNodes && !hasSubscriptions) {
    throw new Error(
      'withNodesConfig: at least one of nodesPlugins, nodes, or subscriptions must be provided'
    );
  }

  // Validate that plugins are provided if nodes are specified
  if (hasNodes && !hasPlugins) {
    throw new Error('withNodesConfig: nodesPlugins must be provided when nodes are specified');
  }

  // Validate that nodes are provided if subscriptions are specified
  if (hasSubscriptions && !hasNodes) {
    throw new Error('withNodesConfig: nodes must be provided when subscriptions are specified');
  }

  return graph => {
    let currentGraph = graph;

    // 1. Apply plugins first (if provided)
    // This registers plugins in the graph so nodes can use them
    if (hasPlugins && config.nodesPlugins) {
      currentGraph = withNodePlugins(config.nodesPlugins)(currentGraph);
    }

    // 2. Apply nodes (if provided)
    // Nodes use plugin types to find compute functions in the registry
    if (hasNodes && config.nodes) {
      currentGraph = withNodes(config.nodes)(currentGraph);
    }

    // 3. Apply subscriptions (if provided)
    // Subscriptions work with nodes that have isSubscribed: true
    if (hasSubscriptions && config.subscriptions) {
      currentGraph = withSubscription(config.subscriptions)(currentGraph);
    }

    return currentGraph;
  };
}
