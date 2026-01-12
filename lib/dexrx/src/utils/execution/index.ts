import type { ExecutionContext, ParallelExecutionOptions } from '../../types/execution-context';
import { EngineExecutionMode } from '../../types/engine-options';
import type { NodeRegistry } from '../../engine/registry';

import { MainThreadContext } from './main-thread-context';
import { WebWorkerContext } from './web-worker-context';
import { NodeWorkerContext } from './node-worker-context';

// Re-export for public API
export { MainThreadContext };
export { WebWorkerContext };
export { NodeWorkerContext };

// Re-export types separately for correct webpack work
export type { ParallelExecutionOptions };

/**
 * Detects execution environment
 */
function detectEnvironment(): 'browser' | 'node' | 'unknown' {
  try {
    // Check Node.js environment
    if (typeof process !== 'undefined' && process && process.versions && process.versions.node) {
      return 'node';
    }

    // Check browser environment
    if (
      new Function(
        'try { return typeof window !== "undefined" && typeof document !== "undefined"; } catch(e) { return false; }'
      )()
    ) {
      return 'browser';
    }
  } catch (e) {
    // Ignore errors
  }

  return 'unknown';
}

/**
 * Creates execution context depending on environment and mode
 *
 * @param registry Plugin registry
 * @param options Options for parallel execution
 * @param mode Execution mode (serial or parallel)
 * @returns Execution context
 */
export function createExecutionContext(
  registry: NodeRegistry,
  options: ParallelExecutionOptions = {},
  mode: EngineExecutionMode = EngineExecutionMode.SERIAL
): ExecutionContext {
  // For serial mode always use main thread
  if (mode === EngineExecutionMode.SERIAL) {
    if (!registry) {
      throw new Error('Registry is required for serial execution mode');
    }
    return new MainThreadContext(registry);
  }

  // For parallel mode detect environment
  const environment = detectEnvironment();

  if (environment === 'browser') {
    // Browser environment with Web Workers
    if (!options?.workerScriptUrl) {
      throw new Error('Worker script URL is required for web workers');
    }

    return new WebWorkerContext({
      maxWorkers: options.maxWorkers ?? 2,
      workerTimeout: options.workerTimeout ?? 5000,
      workerScriptUrl: options.workerScriptUrl,
      logger: options.logger,
    });
  } else if (environment === 'node') {
    // Node.js environment with Worker Threads
    return new NodeWorkerContext({
      maxWorkers: options.maxWorkers ?? 2,
      workerTimeout: options.workerTimeout ?? 5000,
      workerPath: options.workerPath,
      logger: options.logger,
    });
  } else {
    // If we can't detect environment or no worker support,
    // use main thread (if registry provided)
    if (registry) {
      return new MainThreadContext(registry);
    }

    // If no registry, throw error
    throw new Error(
      'No worker support available in this environment and no registry provided for main thread execution'
    );
  }
}
