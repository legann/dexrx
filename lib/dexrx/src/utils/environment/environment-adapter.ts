/**
 * Memory information
 */
export interface IMemoryInfo {
  heapUsed: number;
  heapTotal: number;
  rss: number;
  external: number;
}

/**
 * Runtime environment type
 */
export type EnvironmentType = 'browser' | 'node' | 'unknown';

/**
 * Environment adapter interface
 * Provides abstraction for operations dependent on runtime environment
 */
export interface IEnvironmentAdapter {
  /**
   * Determines environment type
   */
  getEnvironmentType(): EnvironmentType;

  /**
   * Returns memory usage information
   */
  getMemoryUsage(): IMemoryInfo;

  /**
   * Registers handler for application exit event
   * @param callback Function to be called on exit
   * @returns Function to unregister handler
   */
  onExit(callback: () => void): () => void;

  /**
   * Returns number of CPU cores
   */
  getCpuCores(): number;

  /**
   * Returns platform name
   */
  getPlatform(): string;
}

/**
 * Type definitions for working in different environments
 */
export type EventListenerFn = (event?: unknown) => void;

// Declarations for Node.js
export interface NodeProcess {
  memoryUsage(): { heapUsed: number; heapTotal: number; rss: number; external: number };
  platform: string;
  on(event: string, listener: (...args: unknown[]) => void): NodeProcess;
  removeListener(event: string, listener: (...args: unknown[]) => void): NodeProcess;
  versions: { node?: string };
}

// Declarations for browser
export interface BrowserWindow {
  addEventListener(type: string, listener: EventListenerFn): void;
  removeEventListener(type: string, listener: EventListenerFn): void;
}

export interface BrowserNavigator {
  hardwareConcurrency?: number;
  platform?: string;
}

export interface BrowserPerformance {
  memory?: {
    usedJSHeapSize: number;
    totalJSHeapSize: number;
    jsHeapSizeLimit: number;
  };
}

// Additional types for global context
interface GlobalThis {
  window?: BrowserWindow;
  document?: unknown;
  navigator?: BrowserNavigator;
  performance?: BrowserPerformance;
}

/**
 * Environment adapter for Node.js
 */
export class NodeEnvironmentAdapter implements IEnvironmentAdapter {
  getEnvironmentType(): EnvironmentType {
    return 'node';
  }

  getMemoryUsage(): IMemoryInfo {
    try {
      // Import process dynamically to avoid errors in browser
      const processObj =
        typeof process !== 'undefined' ? (process as unknown as NodeProcess) : null;
      if (processObj && typeof processObj.memoryUsage === 'function') {
        const memUsage = processObj.memoryUsage();
        return {
          heapUsed: memUsage.heapUsed,
          heapTotal: memUsage.heapTotal,
          external: memUsage.external,
          rss: memUsage.rss,
        };
      }
    } catch (e) {
      // Ignore errors
    }

    // Fallback in case of error
    return {
      heapUsed: 0,
      heapTotal: 0,
      rss: 0,
      external: 0,
    };
  }

  onExit(callback: () => void): () => void {
    try {
      const processObj =
        typeof process !== 'undefined' ? (process as unknown as NodeProcess) : null;
      if (processObj && typeof processObj.on === 'function') {
        const handler = (): void => {
          try {
            callback();
          } catch (e) {
            // Suppress errors in handler
          }
        };

        processObj.on('beforeExit', handler);

        return () => {
          if (processObj && typeof processObj.removeListener === 'function') {
            processObj.removeListener('beforeExit', handler);
          }
        };
      }
    } catch (e) {
      // Ignore errors
    }

    // Fallback
    return () => {};
  }

  getCpuCores(): number {
    try {
      // Dynamic import to avoid errors
      // Note: for correct browser work this code should be excluded during build
      if (typeof require !== 'undefined') {
        const os = Function('return require("os")')();
        if (os && typeof os.cpus === 'function') {
          const cpus = os.cpus();
          return Array.isArray(cpus) ? cpus.length : 1;
        }
      }
    } catch (e) {
      // Ignore errors
    }

    return 1;
  }

  getPlatform(): string {
    try {
      const processObj =
        typeof process !== 'undefined' ? (process as unknown as NodeProcess) : null;
      if (processObj && typeof processObj.platform === 'string') {
        return processObj.platform;
      }
    } catch (e) {
      // Ignore errors
    }

    return 'unknown';
  }
}

/**
 * Environment adapter for browser
 */
export class BrowserEnvironmentAdapter implements IEnvironmentAdapter {
  getEnvironmentType(): EnvironmentType {
    return 'browser';
  }

  getMemoryUsage(): IMemoryInfo {
    try {
      // Chrome and some other browsers support performance.memory
      const globalObj = globalThis as GlobalThis;
      const perf = globalObj.performance;

      if (
        perf?.memory &&
        typeof perf.memory.usedJSHeapSize === 'number' &&
        typeof perf.memory.totalJSHeapSize === 'number'
      ) {
        return {
          heapUsed: perf.memory.usedJSHeapSize,
          heapTotal: perf.memory.totalJSHeapSize,
          rss: 0,
          external: 0,
        };
      }
    } catch (e) {
      // Ignore errors accessing performance.memory
    }

    // Fallback for other browsers
    return {
      heapUsed: 0,
      heapTotal: 0,
      rss: 0,
      external: 0,
    };
  }

  onExit(callback: () => void): () => void {
    try {
      const globalObj = globalThis as GlobalThis;
      const win = globalObj.window;

      if (win && typeof win.addEventListener === 'function') {
        const handler = (): void => {
          try {
            callback();
          } catch (e) {
            // Suppress errors in handler
          }
        };

        win.addEventListener('beforeunload', handler);

        return () => {
          if (win && typeof win.removeEventListener === 'function') {
            win.removeEventListener('beforeunload', handler);
          }
        };
      }
    } catch (e) {
      // Ignore errors
    }

    // Fallback
    return () => {};
  }

  getCpuCores(): number {
    try {
      const globalObj = globalThis as GlobalThis;
      const nav = globalObj.navigator;

      if (nav && typeof nav.hardwareConcurrency === 'number') {
        return nav.hardwareConcurrency;
      }
    } catch (e) {
      // Ignore errors
    }

    return 1;
  }

  getPlatform(): string {
    try {
      const globalObj = globalThis as GlobalThis;
      const nav = globalObj.navigator;

      if (nav && typeof nav.platform === 'string') {
        return nav.platform;
      }
    } catch (e) {
      // Ignore errors
    }

    return 'browser';
  }
}

/**
 * Environment adapter for unknown environment
 */
export class UnknownEnvironmentAdapter implements IEnvironmentAdapter {
  getEnvironmentType(): EnvironmentType {
    return 'unknown';
  }

  getMemoryUsage(): IMemoryInfo {
    return {
      heapUsed: 0,
      heapTotal: 0,
      rss: 0,
      external: 0,
    };
  }

  onExit(_callback: () => void): () => void {
    return () => {
      /* Empty function for unsubscribe */
    };
  }

  getCpuCores(): number {
    return 1;
  }

  getPlatform(): string {
    return 'unknown';
  }
}

/**
 * Creates environment adapter instance matching current runtime environment
 */
export function createEnvironmentAdapter(): IEnvironmentAdapter {
  try {
    // Detect Node.js environment
    if (
      typeof process !== 'undefined' &&
      process &&
      (process as unknown as NodeProcess).versions &&
      (process as unknown as NodeProcess).versions.node
    ) {
      return new NodeEnvironmentAdapter();
    }

    // Detect browser environment
    if (typeof globalThis !== 'undefined' && 'window' in globalThis && 'document' in globalThis) {
      return new BrowserEnvironmentAdapter();
    }
  } catch (e) {
    // Ignore errors and return default adapter
  }

  // For unknown environment
  return new UnknownEnvironmentAdapter();
}
