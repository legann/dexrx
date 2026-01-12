/**
 * Persistence provider interface
 * Generic interface for saving/loading graph state
 * @category Providers
 */
export interface IPersistenceProvider {
  /**
   * Save state with optional TTL
   */
  saveState<T>(key: string, value: T, options?: { ttl?: number }): Promise<void>;

  /**
   * Load state by key
   */
  loadState<T>(key: string): Promise<T | null>;

  /**
   * Delete state by key
   */
  deleteState(key: string): Promise<void>;
}
