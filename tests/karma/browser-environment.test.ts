// Tests for browser-specific features and browser environment integration
import { createGraph } from '../../lib/dexrx/src/graph';
import { withNodesConfig, withOptions } from '../../lib/dexrx/src/operators';
import { INodePlugin } from 'dexrx';
import { BrowserEnvironmentAdapter } from '../../lib/dexrx/src/utils/environment/environment-adapter';
import { EngineExecutionMode } from '../../lib/dexrx/src/types/engine-options';

// Declare interfaces for browser APIs that we will test
declare global {
  interface Performance {
    memory?: {
      jsHeapSizeLimit: number;
      totalJSHeapSize: number;
      usedJSHeapSize: number;
    };
  }
}

// URL to web worker file (relative to Karma base)
const workerUrl = '/base/tests/workers/web-worker.js';

describe('Browser Environment for DexRx (Build API)', () => {
  // Plugins for tests
  const calculatorPlugin: INodePlugin = {
    type: 'calculator',
    category: 'operational',
    compute: (config: any, inputs: any[]) => {
      const a = config.a || 1;
      const b = config.b || 2;
      return a + b;
    },
  };

  const textProcessorPlugin: INodePlugin = {
    type: 'text-processor',
    category: 'operational',
    compute: (config: any, inputs: any[]) => {
      const text = inputs[0] || '';
      const operation = config.operation || 'count';

      switch (operation) {
        case 'count':
          return text.length;
        case 'uppercase':
          return text.toUpperCase();
        case 'words':
          return text.split(/\s+/).filter((w: string) => w.length > 0).length;
        default:
          return text;
      }
    },
  };

  // Test for checking browser environment detection
  it('should correctly detect browser environment', () => {
    // Create environment adapter
    const adapter = new BrowserEnvironmentAdapter();

    // Check environment type
    expect(adapter.getEnvironmentType()).toBe('browser');

    // Check memory information retrieval
    const memInfo = adapter.getMemoryUsage();
    expect(memInfo).toBeDefined();
    expect(typeof memInfo.heapTotal).toBe('number');
    expect(typeof memInfo.heapUsed).toBe('number');
  });

  // Test for checking CPU information retrieval
  it('should correctly get CPU information in browser', () => {
    const adapter = new BrowserEnvironmentAdapter();

    // Get CPU core count
    const cpuCores = adapter.getCpuCores();

    // Check that number greater than 0 is returned
    expect(cpuCores).toBeGreaterThan(0);
  });

  // Test for checking browser event handling
  it('should correctly register handlers on page exit', () => {
    const adapter = new BrowserEnvironmentAdapter();

    // Create mock for callback function
    const mockCallback = jasmine.createSpy('exitCallback');

    // Register handler
    const unsubscribe = adapter.onExit(mockCallback);

    // Check that unsubscribe function is returned
    expect(typeof unsubscribe).toBe('function');

    // Call unsubscribe function
    unsubscribe();
  });

  // Test for platform information retrieval
  it('should correctly get platform information', () => {
    const adapter = new BrowserEnvironmentAdapter();

    // Get platform
    const platform = adapter.getPlatform();

    // Check that non-empty string is returned
    expect(typeof platform).toBe('string');
    expect(platform.length).toBeGreaterThan(0);
  });

  // Simple test for checking device performance adaptability
  it('should successfully create and destroy engine', async () => {
    // Create graph with Build API
    const graph = createGraph(
      withOptions({
        engine: {
          executionMode: EngineExecutionMode.SERIAL, // Use sequential execution for simplicity
        },
      }),
      withNodesConfig({
        nodesPlugins: [calculatorPlugin],
        nodes: [
          {
            id: 'test',
            type: 'calculator',
            config: { a: 5, b: 7 },
          },
        ],
      })
    );

    // Start graph
    await graph.execute();

    // Check that node is added (via exportState)
    const state = graph.exportState();
    expect(state.nodes['test']).toBeDefined();

    // Free resources
    graph.destroy();
  });

  // Text processing test - simple version without complex async operations
  it('should process text data', async () => {
    // Create graph with Build API
    const graph = createGraph(
      withNodesConfig({
        nodesPlugins: [textProcessorPlugin],
        nodes: [
          {
            id: 'processor',
            type: 'text-processor',
            config: {
              operation: 'uppercase',
              value: 'test text',
            },
          },
        ],
      })
    );

    // Start graph
    await graph.execute();

    // Check created node (via exportState)
    const state = graph.exportState();
    expect(state.nodes['processor']).toBeDefined();

    // Free resources
    graph.destroy();
  });
});
