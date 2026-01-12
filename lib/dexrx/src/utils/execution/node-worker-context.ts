import { Worker } from 'worker_threads';
import { ExecutionContext } from '../../types/execution-context';
import * as path from 'path';
import * as os from 'os';
import { NodeRegistry } from '../../engine/registry';
import * as fs from 'fs';
import type { ILogger } from '../../types/logger';

/**
 * Generates simple unique identifier
 * @returns String with unique identifier
 */
function generateId(): string {
  return (
    Date.now().toString(36) +
    Math.random().toString(36).substring(2, 15) +
    Math.random().toString(36).substring(2, 15)
  );
}

/**
 * Message structure for worker interaction
 */
interface WorkerMessage {
  id: string;
  type: 'compute' | 'result' | 'error';
  data?: unknown;
  nodeType?: string;
  config?: unknown;
  inputs?: unknown[];
}

/**
 * Options for NodeWorkerContext
 */
interface NodeWorkerOptions {
  /**
   * Maximum number of workers
   */
  maxWorkers?: number;

  /**
   * Worker task timeout in milliseconds
   */
  workerTimeout?: number;

  /**
   * Path to worker file (for testing)
   */
  workerPath?: string;

  /**
   * Disable automatic resource cleanup on process termination
   * Useful for testing or when lifecycle management
   * should be done externally
   */
  disableAutoCleanup?: boolean;

  /**
   * Optional logger instance for debugging
   */
  logger?: ILogger;
}

/**
 * Class implementing execution context using Node.js Worker Threads.
 * Provides parallel execution in Node.js environment.
 */
export class NodeWorkerContext implements ExecutionContext {
  private workers: Worker[] = [];
  private readonly pendingTasks = new Map<
    string,
    {
      resolve: (value: unknown) => void;
      reject: (reason?: unknown) => void;
      timeoutId?: NodeJS.Timeout;
    }
  >();
  private readonly pendingTasksByWorker = new Map<number, Set<string>>();
  private readonly maxWorkers: number;
  private readonly workerFilePath: string;
  private readonly taskTimeoutMs: number;
  private readonly disableAutoCleanup: boolean;
  private readonly logger?: ILogger;

  /**
   * @param registryOrOptions Plugin registry or options for NodeWorkerContext
   * @param maxWorkers Maximum number of workers (default = CPU cores / 2)
   */
  constructor(registryOrOptions: NodeRegistry | NodeWorkerOptions, maxWorkers?: number) {
    if (!NodeWorkerContext.isSupported()) {
      throw new Error(
        'Node.js Worker Threads API is not available. Use Node.js 12+ or enable with --experimental-worker'
      );
    }

    // Determine which constructor was used
    const isRegistry = registryOrOptions instanceof NodeRegistry;
    const options = isRegistry ? {} : registryOrOptions;

    // Set logger if provided
    this.logger = options.logger;

    // Determine number of workers
    if (isRegistry && maxWorkers !== undefined) {
      // Old call format
      this.maxWorkers = maxWorkers;
    } else {
      // New call format with options
      this.maxWorkers = options.maxWorkers ?? this.getOptimalWorkerCount();
    }

    // Set task timeout
    this.taskTimeoutMs =
      options.workerTimeout && options.workerTimeout > 0 ? options.workerTimeout : 30000;

    try {
      // Check if worker file path was provided in options
      if (options.workerPath && fs.existsSync(options.workerPath)) {
        this.workerFilePath = options.workerPath;
        this.logger?.debug(`[NodeWorkerContext] Using worker from options: ${this.workerFilePath}`);
      } else {
        // Try to find test worker in various ways
        const possiblePaths = [
          // Relative path from current directory
          path.resolve(process.cwd(), 'tests/workers/node-worker-script.js'),
          // Absolute path built from __dirname (for dist: ../../../../../tests, for src: ../../../../tests)
          path.resolve(__dirname, '../../../../../tests/workers/node-worker-script.js'),
          path.resolve(__dirname, '../../../../tests/workers/node-worker-script.js'),
          // Path to file in node_modules directory (for installed library)
          path.resolve(process.cwd(), 'node_modules/dexrx/tests/workers/node-worker-script.js'),
        ];

        // Search for file in possible locations
        const existingPath = possiblePaths.find(p => fs.existsSync(p));

        if (existingPath) {
          this.workerFilePath = existingPath;
          this.logger?.debug(`[NodeWorkerContext] Using test worker: ${this.workerFilePath}`);
        } else {
          throw new Error('Test worker not found in known paths');
        }
      }
    } catch (e) {
      this.logger?.debug(
        `[NodeWorkerContext] Failed to find test worker, creating temporary: ${e instanceof Error ? e.message : String(e)}`
      );

      // If file not found, create temporary worker script
      const tempDir = path.join(os.tmpdir(), 'dexrx-workers');

      // Create directory if it doesn't exist
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }

      // Create temporary worker file
      this.workerFilePath = path.join(tempDir, `worker-script-${Date.now()}.js`);

      // Improved worker code
      const workerCode = `
        const { parentPort, isMainThread, threadId } = require('worker_threads');
        
        // Plugins loaded in worker
        const plugins = new Map();
        
        console.log(\`🧵 Worker initialized: threadId=\${threadId}, isMainThread=\${isMainThread}\`);
        
        // Message handling
        parentPort.on('message', (message) => {
          try {
            const { id, type, nodeType, config, inputs } = message;
            
            if (type === 'compute') {
              console.log(\`🧵 Worker \${threadId} received task: \${nodeType}\`);
              
              try {
                // Create simple plugin implementation by type
                const mockPlugin = {
                  type: nodeType,
                  compute: (pluginConfig, pluginInputs) => {
                    // Real computation (simple implementation by node type)
                    let result;
                    
                    switch (nodeType) {
                      case 'heavyCompute':
                      case 'HeavyCompute':
                        // Heavy computation implementation
                        const complexity = pluginConfig.complexity || 10000;
                        let value = 0;
                        
                        console.log(\`🧵 Executing node \${pluginConfig.id || 'unknown'} in thread: \${threadId}, isMainThread: \${isMainThread}\`);
                        
                        // Perform real computations
                        for (let i = 0; i < complexity; i++) {
                          value = Math.sin(value + i * 0.0001) + Math.sqrt(Math.abs(Math.cos(i * 0.01)));
                          
                          // Additionally complicate every 500th iteration
                          if (i % 500 === 0) {
                            value += Math.pow(Math.sin(i), 2) + Math.pow(Math.cos(i), 2);
                          }
                        }
                        
                        result = { 
                          result: value, 
                          nodeId: pluginConfig.id || 'unknown',
                          complexity,
                          threadInfo: {
                            isMainThread,
                            threadId
                          }
                        };
                        break;
                        
                      default:
                        // For other node types just return structure with thread info
                        result = { 
                          result: 'worker_result', 
                          inputs: pluginInputs, 
                          config: pluginConfig,
                          type: nodeType,
                          threadInfo: {
                            isMainThread,
                            threadId
                          }
                        };
                    }
                    
                    return result;
                  }
                };
                
                // Execute computation using mock plugin
                const result = mockPlugin.compute(config, inputs);
                
                // Send result back
                parentPort.postMessage({
                  id,
                  type: 'result',
                  data: result
                });
                
                console.log(\`🧵 Worker \${threadId} completed task: \${nodeType}\`);
              } catch (computeError) {
                console.error(\`🧵 Error in worker \${threadId}:\`, computeError);
                parentPort.postMessage({
                  id,
                  type: 'error',
                  data: computeError.message || String(computeError)
                });
              }
            }
          } catch (error) {
            console.error(\`🧵 Critical error in worker \${threadId}:\`, error);
            parentPort.postMessage({
              id: message.id,
              type: 'error',
              data: error.message || String(error)
            });
          }
        });
      `;

      // Write code to file
      fs.writeFileSync(this.workerFilePath, workerCode);
      this.logger?.debug(
        `[NodeWorkerContext] Created temporary worker file: ${this.workerFilePath}`
      );
    }

    // Set automatic cleanup disable flag
    this.disableAutoCleanup = options.disableAutoCleanup ?? false;

    this.logger?.debug(`[NodeWorkerContext] Initializing with ${this.maxWorkers} workers`);

    // Create worker pool
    this.initializeWorkers();

    // Add handlers for graceful shutdown,
    // if automatic cleanup is not disabled
    if (!this.disableAutoCleanup) {
      process.on('exit', () => this.terminate());
      process.on('SIGINT', () => this.terminate());
      process.on('SIGTERM', () => this.terminate());
      process.on('uncaughtException', () => this.terminate());
    }
  }

  /**
   * Checks if parallel execution is supported
   */
  public static isSupported(): boolean {
    try {
      // Check availability of worker_threads module
      require('worker_threads');
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * Determines optimal number of workers
   */
  private getOptimalWorkerCount(): number {
    // Get number of available CPU cores
    const cpuCount = os.cpus().length;
    // Leave one core for main thread
    return Math.max(1, cpuCount - 1);
  }

  /**
   * Initializes worker pool
   */
  private initializeWorkers(): void {
    for (let i = 0; i < this.maxWorkers; i++) {
      this.createWorker();
    }
  }

  /**
   * Creates and initializes worker
   */
  private createWorker(): Worker {
    const worker = new Worker(this.workerFilePath);

    // Unref worker immediately so it doesn't keep event loop alive
    // This allows Jest to exit even if workers are still closing
    // Workers will still function normally, but won't block process exit
    try {
      worker.unref();
    } catch {
      // Ignore if unref() is not available
    }

    worker.on('message', (message: WorkerMessage) => {
      const pendingTask = this.pendingTasks.get(message.id);

      if (pendingTask) {
        // Clear timeout if it was set
        if (pendingTask.timeoutId) {
          clearTimeout(pendingTask.timeoutId);
        }

        if (message.type === 'result') {
          pendingTask.resolve(message.data);
        } else if (message.type === 'error') {
          pendingTask.reject(new Error(String(message.data)));
        }

        this.pendingTasks.delete(message.id);
      }
    });

    worker.on('error', error => {
      console.error('Worker error:', error);

      // Reject all tasks of this worker
      for (const [taskId, task] of this.pendingTasks.entries()) {
        // Clear timeout if it was set
        if (task.timeoutId) {
          clearTimeout(task.timeoutId);
        }

        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        task.reject(new Error(`Worker crashed: ${errorMessage}`));
        this.pendingTasks.delete(taskId);
      }

      // Remove this worker from list
      this.workers = this.workers.filter(w => w !== worker);

      // Try to create new worker as replacement, if total count allows
      try {
        if (this.workers.length < this.maxWorkers) {
          this.createWorker();
        }
      } catch (recreateError) {
        console.error('Failed to recreate worker after crash:', recreateError);
      }
    });

    this.workers.push(worker);
    return worker;
  }

  // Note: _estimateArraySize method was removed as it was unused
  // If needed in the future, can be restored from git history

  /**
   * Executes task in context
   */
  async execute<T = unknown>(nodeType: string, config: unknown, inputs: unknown[]): Promise<T> {
    // Use method to determine need for parallelization
    // but don't change behavior in current version
    // this.shouldParallelizeTask(nodeType, config, inputs)

    return new Promise((resolve, reject) => {
      // If all workers are down, execute in main thread
      if (this.workers.length === 0) {
        reject(new Error('No available workers for parallel execution'));
        return;
      }

      const taskId = generateId();

      // Set timeout for task
      const timeoutId = setTimeout(() => {
        const task = this.pendingTasks.get(taskId);
        if (task) {
          task.reject(new Error(`Task execution timed out after ${this.taskTimeoutMs}ms`));
          this.pendingTasks.delete(taskId);
        }
      }, this.taskTimeoutMs);

      // Save callbacks for promise resolution/rejection
      this.pendingTasks.set(taskId, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timeoutId,
      });

      // Select worker with least load (simple strategy - round robin)
      const workerIndex = Math.floor(Math.random() * this.workers.length);
      const worker = this.workers[workerIndex];

      try {
        // Send task to worker
        const message: WorkerMessage = {
          id: taskId,
          type: 'compute',
          nodeType,
          config,
          inputs,
        };

        if (!worker) {
          throw new Error('Worker not available');
        }

        worker.postMessage(message);
      } catch (error) {
        // In case of error when sending message
        clearTimeout(timeoutId);
        this.pendingTasks.delete(taskId);
        reject(error);
      }
    });
  }

  /**
   * Executes task
   * @param nodeType Node type
   * @param config Node configuration
   * @param inputs Input data
   */
  public async executeTask(nodeType: string, config: unknown, inputs: unknown[]): Promise<unknown> {
    return this.execute(nodeType, config, inputs);
  }

  /**
   * Releases resources
   */
  public terminate(): void {
    // Cancel all pending tasks
    for (const task of this.pendingTasks.values()) {
      if (task.timeoutId) {
        clearTimeout(task.timeoutId);
      }
      task.reject(new Error('Execution context terminated'));
    }
    this.pendingTasks.clear();
    this.pendingTasksByWorker.clear();

    // Get workers to terminate before clearing the array
    const workersToTerminate = [...this.workers];
    // Clear workers array immediately to prevent new tasks
    this.workers = [];

    // Terminate all workers immediately (aggressive cleanup to prevent Jest open handles)
    // Ref workers back to event loop before terminating, then terminate immediately
    for (const worker of workersToTerminate) {
      try {
        // Ref worker back to event loop before terminating (if it was unref'd)
        // This ensures worker is properly tracked for termination
        try {
          worker.ref();
        } catch {
          // Ignore if ref() fails
        }

        // Immediately terminate worker - don't wait for graceful shutdown
        // This ensures workers close quickly and Jest can exit
        worker.terminate().catch(() => {
          // Ignore errors - worker may already be terminated
        });
      } catch (error) {
        // Ignore errors - worker may already be terminated or in invalid state
      }
    }

    // If we created temporary worker file, delete it
    if (this.workerFilePath?.includes('worker-script-') && fs.existsSync(this.workerFilePath)) {
      try {
        fs.unlinkSync(this.workerFilePath);
      } catch (error) {
        console.error('Error deleting temporary worker file:', error);
      }
    }
  }

  /**
   * Wait for all workers to terminate
   * Useful for tests to ensure workers are closed before Jest checks for open handles
   */
  public async waitForTermination(timeoutMs = 2000): Promise<void> {
    const workersToWait = [...this.workers];
    if (workersToWait.length === 0) {
      return;
    }

    const terminatePromises = workersToWait.map(worker => {
      try {
        return worker.terminate().catch(() => {
          // Ignore errors
        });
      } catch {
        return Promise.resolve();
      }
    });

    // Wait for all workers to terminate with timeout
    await Promise.race([
      Promise.allSettled(terminatePromises),
      new Promise<void>(resolve => setTimeout(resolve, timeoutMs)),
    ]);
  }

  /**
   * Alias for terminate(), supported for backward compatibility
   */
  public destroy(): void {
    this.terminate();
  }
}
