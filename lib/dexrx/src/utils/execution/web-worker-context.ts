import { ExecutionContext } from '../../types/execution-context';
import type { ILogger } from '../../types/logger';

// Declare types for browser environment if not defined
interface WorkerConstructor {
  new (scriptURL: string): WorkerInstance;
}

interface WorkerInstance {
  onmessage: ((e: MessageEvent) => void) | null;
  onerror: ((e: Event) => void) | null;
  postMessage(message: unknown): void;
  terminate(): void;
}

// Interface for message structure exchanged with worker
interface WorkerTaskMessage {
  type: string;
  taskId?: number;
  nodeType?: string;
  config?: import('../../types/utils').NodeConfig;
  inputs?: readonly unknown[];
  pluginType?: string;
}

/**
 * Execution context implementation for web workers (browser environment).
 * Used for parallel node execution in browser.
 */
export class WebWorkerContext implements ExecutionContext {
  private workers: WorkerInstance[] = [];
  private readonly taskQueue: Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (reason?: unknown) => void;
      timeout: ReturnType<typeof setTimeout>;
    }
  > = new Map();
  private taskIdCounter = 0;
  private readonly registeredPlugins: Set<string> = new Set();
  private readonly maxWorkers: number;
  private readonly workerTimeout: number;
  private readonly workerScriptUrl: string;
  private readonly logger?: ILogger;

  /**
   * Checks if Web Workers are supported in current environment.
   * @returns true if Web Workers are supported, otherwise false
   */
  public static isSupported(): boolean {
    return (
      typeof globalThis !== 'undefined' &&
      typeof (globalThis as unknown as { Worker?: unknown }).Worker === 'function'
    );
  }

  /**
   * @param options Options for context initialization
   */
  constructor(options: {
    maxWorkers?: number;
    workerTimeout?: number;
    workerScriptUrl: string;
    logger?: ILogger;
  }) {
    this.maxWorkers = options.maxWorkers ?? 2;
    this.workerTimeout = options.workerTimeout ?? 5000;
    this.workerScriptUrl = options.workerScriptUrl;
    this.logger = options.logger;

    if (!this.isWebWorkerSupported()) {
      this.logger?.warn(
        'Web Workers are not supported in current environment. Tasks will be executed in main thread.'
      );
    }

    // Initialize workers
    void this.initialize();
  }

  /**
   * Checks if Web Workers are supported in current environment.
   */
  private isWebWorkerSupported(): boolean {
    return WebWorkerContext.isSupported();
  }

  /**
   * Handles messages from worker
   */
  private handleWorkerMessage(e: MessageEvent): void {
    const message = e.data as WorkerTaskMessage;

    if (!message?.taskId || !this.taskQueue.has(message.taskId)) {
      return;
    }

    const task = this.taskQueue.get(message.taskId);
    if (!task) return;

    const { resolve, reject, timeout } = task;

    clearTimeout(timeout);

    if (message.type === 'result') {
      resolve(message.inputs?.[0]);
    } else if (message.type === 'error') {
      const errorMessage =
        typeof message.inputs?.[0] === 'string'
          ? message.inputs[0]
          : 'Execution error in Web Worker';
      reject(new Error(errorMessage));
    }

    this.taskQueue.delete(message.taskId);
  }

  /**
   * Creates new worker and sets up its event handlers
   */
  private createWorker(): WorkerInstance | null {
    try {
      const worker = new (globalThis as unknown as { Worker: WorkerConstructor }).Worker(
        this.workerScriptUrl
      );

      // Set up event handlers
      worker.onmessage = (e: MessageEvent): void => this.handleWorkerMessage(e);

      // Error handling
      worker.onerror = (e: Event): void => {
        const taskIds = Array.from(this.taskQueue.keys());

        // Reject all tasks related to this worker
        for (const taskId of taskIds) {
          const pendingTask = this.taskQueue.get(taskId);
          if (pendingTask) {
            clearTimeout(pendingTask.timeout);
            pendingTask.reject(
              new Error(
                `Error in Web Worker: ${(e as { message?: string }).message ?? 'Unknown error'}`
              )
            );
            this.taskQueue.delete(taskId);
          }
        }

        // Remove problematic worker and create new one
        const index = this.workers.indexOf(worker);
        if (index !== -1) {
          this.workers.splice(index, 1);
          const newWorker = this.createWorker();
          if (newWorker) {
            this.workers.push(newWorker);
          }
        }
      };

      return worker;
    } catch (error) {
      this.logger?.error('Failed to create Web Worker:', error);
      return null;
    }
  }

  /**
   * Initializes worker pool
   */
  async initialize(): Promise<void> {
    if (!this.isWebWorkerSupported()) {
      return;
    }

    // Ensure maxWorkers is defined
    const maxWorkers = this.maxWorkers || 4;

    // Create worker pool
    for (let i = 0; i < maxWorkers; i++) {
      const worker = this.createWorker();
      if (worker) {
        this.workers.push(worker);
      }
    }
  }

  /**
   * Estimates data size in input parameters
   * @private
   * @param {unknown[]} inputs - Input data for task
   * @returns {number} Data size estimate
   */
  private estimateDataSize(inputs: readonly unknown[]): number {
    if (!inputs || inputs.length === 0) return 0;

    let totalSize = 0;

    for (const input of inputs) {
      // Arrays - count number of elements
      if (Array.isArray(input)) {
        totalSize += this.estimateArraySize(input);
      }
      // TypedArray (Float32Array, Uint8Array, etc.)
      else if (ArrayBuffer.isView(input)) {
        // For typed arrays use byteLength
        const typedArray = input as unknown as { byteLength: number };
        totalSize += typedArray.byteLength / 4; // Roughly convert bytes to element count
      }
      // Objects - count number of properties
      else if (input !== null && typeof input === 'object') {
        const obj = input as Record<string, unknown>;
        totalSize += Object.keys(obj).length;

        // If object contains arrays or other objects in properties, account for their size
        for (const key in obj) {
          const value = obj[key];
          if (Array.isArray(value)) {
            totalSize += this.estimateArraySize(value);
          } else if (value !== null && typeof value === 'object') {
            totalSize += 5; // Simplified estimate for nested objects
          }
        }
      }
    }

    return totalSize;
  }

  /**
   * Estimates array size including nested arrays
   * @private
   * @param {unknown[]} array - Array to estimate
   * @returns {number} Array size
   */
  private estimateArraySize(array: readonly unknown[]): number {
    let size = array.length;

    // Check for nested arrays
    for (const item of array) {
      if (Array.isArray(item)) {
        size += this.estimateArraySize(item);
      } else if (item !== null && typeof item === 'object') {
        size += Object.keys(item).length;
      }
    }

    return size;
  }

  /**
   * Determines if task should be executed in worker
   * @private
   * @param {string} nodeType - Node/plugin type
   * @param {NodeConfig} config - Node configuration
   * @param {unknown[]} inputs - Input data for task
   * @returns {boolean} true if task should be executed in worker
   */
  private shouldParallelizeTask(
    nodeType: string,
    config: import('../../types/utils').NodeConfig,
    inputs: readonly unknown[]
  ): boolean {
    // Estimate input data size
    const dataSize = this.estimateDataSize(inputs);

    // Nodes that always require parallel execution
    const heavyNodeTypes = [
      'heavyCompute',
      'imageProcessing',
      'matrixCalculation',
      'dataTransformation',
      'textAnalysis',
      'cryptoOperation',
      'dataMining',
    ];

    // If node type is in heavy list - execute in parallel immediately
    if (heavyNodeTypes.includes(nodeType)) {
      return true;
    }

    // Configuration indicates heavy task
    if (config) {
      // Check iterations parameter for computational nodes
      const iterations = config.iterations;
      if (typeof iterations === 'number' && iterations > 10000) {
        return true;
      }

      // Check explicit parallel execution flag
      if (config.forceParallel === true) {
        return true;
      }

      // Task contains large data arrays
      if (config.data && Array.isArray(config.data) && config.data.length > 5000) {
        return true;
      }
    }

    // Large data volumes passed through inputs
    if (dataSize > 1000) {
      return true;
    }

    // By default - don't use worker for small tasks
    return false;
  }

  /**
   * Executes node task in worker
   */
  async executeTask(task: {
    nodeType: string;
    config: import('../../types/utils').NodeConfig;
    inputs: readonly unknown[];
  }): Promise<unknown> {
    const { nodeType, config, inputs } = task;
    return this.execute(nodeType, config, inputs);
  }

  /**
   * Executes task in context
   */
  async execute<T = unknown>(
    nodeType: string,
    config: import('../../types/utils').NodeConfig,
    inputs: readonly unknown[]
  ): Promise<T> {
    // Check if task should be executed in parallel
    const shouldParallelize = this.shouldParallelizeTask(nodeType, config, inputs);

    if (!shouldParallelize) {
      throw new Error(
        'Task is not suitable for parallel execution. Use MainThreadContext for light tasks.'
      );
    }

    if (!this.workers.length || !this.isWebWorkerSupported()) {
      // If workers are not supported or failed to create,
      // execute in main thread (this should be implemented separately)
      throw new Error('Web Workers are not supported or failed to create. Use MainThreadContext.');
    }

    const taskId = this.taskIdCounter++;

    // Select worker from pool (simple round-robin strategy)
    const workerIndex = taskId % this.workers.length;
    const worker = this.workers[workerIndex];

    if (!worker) {
      throw new Error('Failed to get working Web Worker instance');
    }

    return new Promise((resolve, reject) => {
      // Set timeout for task
      const timeout = setTimeout(() => {
        this.taskQueue.delete(taskId);
        reject(new Error(`Task execution timeout in Web Worker (${this.workerTimeout}ms)`));
      }, this.workerTimeout);

      // Add task to queue
      this.taskQueue.set(taskId, {
        resolve: resolve as (value: unknown) => void,
        reject: reject as (reason?: unknown) => void,
        timeout,
      });

      // Send message to worker
      worker.postMessage({
        type: 'execute',
        taskId,
        nodeType,
        config,
        inputs,
      } as WorkerTaskMessage);
    });
  }

  /**
   * Registers plugin for use in worker
   */
  async registerPlugin(pluginType: string): Promise<void> {
    if (this.registeredPlugins.has(pluginType)) {
      return; // Plugin already registered
    }

    this.registeredPlugins.add(pluginType);

    // Send plugin registration message to all workers
    for (const worker of this.workers) {
      worker.postMessage({
        type: 'register_plugin',
        pluginType,
      } as WorkerTaskMessage);
    }
  }

  /**
   * Releases execution context resources (alias for destroy for compatibility)
   */
  terminate(): void {
    void this.destroy();
  }

  /**
   * Releases execution context resources
   */
  async destroy(): Promise<void> {
    // Terminate all workers
    for (const worker of this.workers) {
      worker.terminate();
    }

    // Clear task queue
    for (const [taskId, { reject, timeout }] of this.taskQueue.entries()) {
      clearTimeout(timeout);
      reject(new Error('Execution context was destroyed'));
      this.taskQueue.delete(taskId);
    }

    this.workers = [];
    this.registeredPlugins.clear();
  }
}
