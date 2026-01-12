import type { GraphOperator } from '../graph';
import type { INodePlugin } from '../types/node-plugin';

/**
 * Registers external plugins for use in the graph
 * Plugins are registered in the NodeRegistry before Build API plugins
 *
 * @param plugins - Array of node plugins to register
 *
 * @example
 * ```typescript
 * import { loadPluginFromNodeType } from '@dexrx/lambda-shared/src/node-plugins';
 *
 * const plugins = ['fetch'].map(type =>
 *   loadPluginFromNodeType(type)
 * );
 *
 * const graph = createGraph(
 *   withNodePlugins(plugins),
 *   source('data', fetchData)
 * );
 * ```
 */
export function withNodePlugins(plugins: INodePlugin[]): GraphOperator {
  return graph => {
    const pluginsMap = new Map<string, INodePlugin>();

    // Add existing plugins if any
    if (graph.plugins) {
      for (const [type, plugin] of graph.plugins) {
        pluginsMap.set(type, plugin);
      }
    }

    // Add new plugins
    for (const plugin of plugins) {
      pluginsMap.set(plugin.type, plugin);
    }

    return {
      ...graph,
      plugins: pluginsMap,
    };
  };
}
