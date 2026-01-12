import type { IPersistenceProvider } from '../interfaces';

/**
 * In-memory persistence provider implementation
 * Stores state in memory (lost on process restart)
 * @category Providers
 */
export class MemoryStateProvider implements IPersistenceProvider {
  private readonly storage = new Map<string, { value: unknown; expires?: number }>();

  async saveState<T>(key: string, value: T, options?: { ttl?: number }): Promise<void> {
    this.storage.set(key, {
      value,
      expires: options?.ttl ? Date.now() + options.ttl * 1000 : undefined,
    });
  }

  async loadState<T>(key: string): Promise<T | null> {
    const item = this.storage.get(key);

    if (!item) {
      return null;
    }

    // Check expiration
    if (item.expires && item.expires < Date.now()) {
      this.storage.delete(key);
      return null;
    }

    return item.value as T;
  }

  async deleteState(key: string): Promise<void> {
    this.storage.delete(key);
  }

  /**
   * Clears all stored state
   */
  clear(): void {
    this.storage.clear();
  }

  /**
   * Gets all stored keys
   */
  getKeys(): string[] {
    return Array.from(this.storage.keys());
  }
}
