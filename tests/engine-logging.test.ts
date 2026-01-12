import { createGraph } from '../lib/dexrx/src/graph';
import { withNodesConfig, withLoggerProvider } from '../lib/dexrx/src/operators';
import { ConsoleLoggerProvider } from '../lib/dexrx/src/providers/memory/logger';
import { LogLevel } from '../lib/dexrx/src/types/logger';
import { INodePlugin } from 'dexrx';

// Test plugins
const staticPlugin: INodePlugin = {
  type: 'static',
  category: 'data',
  compute: (_config: unknown, _inputs: unknown[]) => ({ value: 42 })
};

const doublePlugin: INodePlugin = {
  type: 'double',
  category: 'operational',
  compute: (config: unknown, inputs: unknown[]) => {
    const input = inputs[0] && ((inputs[0] as Record<string, unknown>).value) 
      ? ((inputs[0] as Record<string, unknown>).value) 
      : 0;
    return { value: (input as number) * 2 };
  }
};

const errorPlugin: INodePlugin = {
  type: 'error',
  category: 'operational',
  compute: () => { throw new Error('Test error'); }
};

describe('ExecutableGraph - Event Logging (Build API)', () => {
  it('should support logger provider registration', () => {
    const loggerProvider = new ConsoleLoggerProvider({ level: LogLevel.DEBUG });
    
    const graph = createGraph(
      withLoggerProvider(loggerProvider),
      withNodesConfig({
        nodesPlugins: [staticPlugin],
        nodes: [
          {
            id: 'static-node',
            type: 'static',
            config: { isSubscribed: true }
          }
        ]
      })
    );

    expect(graph).toBeDefined();
    graph.destroy();
  });

  it('should work with logger provider', async () => {
    const loggerProvider = new ConsoleLoggerProvider({ level: LogLevel.INFO });
    
    const graph = createGraph(
      withLoggerProvider(loggerProvider),
      withNodesConfig({
        nodesPlugins: [staticPlugin],
        nodes: [
          {
            id: 'static-node',
            type: 'static',
            config: { isSubscribed: true }
          }
        ]
      })
    );

    await graph.execute();
    await new Promise(resolve => setTimeout(resolve, 100));

    const state = graph.exportState();
    expect(state.nodes['static-node'].currentValue).toBeDefined();

    graph.destroy();
  });

  it('should handle errors with logger provider', async () => {
    const loggerProvider = new ConsoleLoggerProvider({ level: LogLevel.ERROR });
    
    const graph = createGraph(
      withLoggerProvider(loggerProvider),
      withNodesConfig({
        nodesPlugins: [errorPlugin],
        nodes: [
          {
            id: 'error-node',
            type: 'error',
            config: { isSubscribed: true }
          }
        ]
      })
    );

    await graph.execute();
    await new Promise(resolve => setTimeout(resolve, 100));

    const state = graph.exportState();
    // Error node should have null value due to error
    expect(state.nodes['error-node'].currentValue).toBeNull();

    graph.destroy();
  });

  it('should support different log levels', () => {
    const debugLogger = new ConsoleLoggerProvider({ level: LogLevel.DEBUG });
    const infoLogger = new ConsoleLoggerProvider({ level: LogLevel.INFO });
    const warnLogger = new ConsoleLoggerProvider({ level: LogLevel.WARN });
    const errorLogger = new ConsoleLoggerProvider({ level: LogLevel.ERROR });

    expect(debugLogger.getLevel()).toBe(LogLevel.DEBUG);
    expect(infoLogger.getLevel()).toBe(LogLevel.INFO);
    expect(warnLogger.getLevel()).toBe(LogLevel.WARN);
    expect(errorLogger.getLevel()).toBe(LogLevel.ERROR);
  });

  it('should work with multiple nodes and logger provider', async () => {
    const loggerProvider = new ConsoleLoggerProvider({ level: LogLevel.INFO });
    
    const graph = createGraph(
      withLoggerProvider(loggerProvider),
      withNodesConfig({
        nodesPlugins: [staticPlugin, doublePlugin],
        nodes: [
          {
            id: 'static-node',
            type: 'static',
            config: { isSubscribed: true }
          },
          {
            id: 'double-node',
            type: 'double',
            inputs: ['static-node'],
            config: { isSubscribed: true }
          }
        ]
      })
    );

    await graph.execute();
    await new Promise(resolve => setTimeout(resolve, 100));

    const state = graph.exportState();
    expect(state.nodes['static-node'].currentValue).toBeDefined();
    expect(state.nodes['double-node'].currentValue).toBeDefined();

    graph.destroy();
  });

  it('should support logger level changes', () => {
    const loggerProvider = new ConsoleLoggerProvider({ level: LogLevel.INFO });
    
    expect(loggerProvider.getLevel()).toBe(LogLevel.INFO);
    expect(loggerProvider.isLevelEnabled(LogLevel.INFO)).toBe(true);
    expect(loggerProvider.isLevelEnabled(LogLevel.DEBUG)).toBe(false);
    
    loggerProvider.setLevel(LogLevel.DEBUG);
    expect(loggerProvider.getLevel()).toBe(LogLevel.DEBUG);
    expect(loggerProvider.isLevelEnabled(LogLevel.DEBUG)).toBe(true);
  });
});
