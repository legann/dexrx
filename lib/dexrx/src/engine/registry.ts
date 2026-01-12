import type { INodePlugin } from '../types/node-plugin';
import { INodeRegistry } from '../types/registry-api';

/**
 * @internal
 * Imperative API - not exported from public API
 * Use Build API (createGraph, ExecutableGraph) instead
 *
 * This class is exported for internal use only (Build API, tests within package)
 * External code should use Build API instead
 */
export class NodeRegistry implements INodeRegistry {
  private readonly plugins = new Map<string, INodePlugin>();

  /**
   * Registers a new plugin
   * @param plugin Plugin to register
   * @throws Error if plugin with same type already registered
   */
  register(plugin: INodePlugin): void {
    if (this.plugins.has(plugin.type)) {
      throw new Error(`Plugin with type '${plugin.type}' is already registered`);
    }
    this.plugins.set(plugin.type, plugin);
  }

  /**
   * Gets plugin by type
   * @param type Plugin type
   * @returns Plugin instance
   * @throws Error if plugin not found
   */
  get(type: string): INodePlugin {
    const plugin = this.plugins.get(type);
    if (!plugin) {
      throw new Error(`Unknown node type: ${type}`);
    }
    return plugin;
  }

  /**
   * Checks if plugin type is registered
   * @param type Plugin type
   * @returns true if plugin is registered
   */
  has(type: string): boolean {
    return this.plugins.has(type);
  }

  /**
   * Returns list of all registered plugin types
   * @returns Iterator with plugin types
   */
  getPluginTypes(): IterableIterator<string> {
    return this.plugins.keys();
  }

  /**
   * Returns number of registered plugins
   * @returns Number of plugins
   */
  public get size(): number {
    return this.plugins.size;
  }

  /**
   * Clears all registered plugins
   */
  clear(): void {
    this.plugins.clear();
  }
}
