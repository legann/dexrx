import { MainThreadContext } from '../lib/dexrx/src/utils/execution/main-thread-context';
import { NodeRegistry } from '../lib/dexrx/src/engine/registry';
import { INodePlugin } from 'dexrx';

// Test plugin definitions
const NumberSourcePlugin: INodePlugin = {
  type: 'NumberSource',
  category: 'data',
  compute: (config: { value: number }) => config.value
};

const MultiplyPlugin: INodePlugin = {
  type: 'Multiply',
  category: 'operational',
  compute: (config: { factor: number }, inputs: number[]) => inputs[0] * config.factor
};

const ThrowsErrorPlugin: INodePlugin = {
  type: 'ThrowsError',
  category: 'operational',
  compute: () => {
    throw new Error('Test error');
  }
};

const AsyncComputePlugin: INodePlugin = {
  type: 'AsyncCompute',
  category: 'operational',
  compute: (config: { delay: number }, inputs: number[]) => {
    return new Promise((resolve) => {
      setTimeout(() => resolve(inputs[0] * 2), config.delay);
    });
  }
};

describe('MainThreadContext', () => {
  let context: MainThreadContext;
  let registry: NodeRegistry;
  
  beforeEach(() => {
    registry = new NodeRegistry();
    registry.register(NumberSourcePlugin);
    registry.register(MultiplyPlugin);
    registry.register(ThrowsErrorPlugin);
    registry.register(AsyncComputePlugin);
    
    context = new MainThreadContext(registry);
  });
  
  afterEach(() => {
    // Free resources after each test
    context.terminate();
  });
  
  it('creates context with registry', () => {
    expect(context).toBeDefined();
  });
  
  it('executes simple computation', async () => {
    const result = await context.execute('NumberSource', { value: 42 }, []);
    expect(result).toBe(42);
  });
  
  it('passes input parameters to plugin', async () => {
    const input = await context.execute('NumberSource', { value: 10 }, []);
    const result = await context.execute('Multiply', { factor: 5 }, [input]);
    expect(result).toBe(50);
  });
  
  it('computation chain works correctly', async () => {
    const input = await context.execute('NumberSource', { value: 5 }, []);
    const intermediate = await context.execute('Multiply', { factor: 2 }, [input]);
    const result = await context.execute('Multiply', { factor: 3 }, [intermediate]);
    expect(result).toBe(30);
  });
  
  it('correctly handles errors in plugins', async () => {
    let errorThrown = false;
    try {
      await context.execute('ThrowsError', {}, []);
    } catch (error) {
      errorThrown = true;
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain('Test error');
    }
    expect(errorThrown).toBe(true);
  });
  
  it('returns error for non-existent plugin', async () => {
    let errorThrown = false;
    try {
      await context.execute('NonExistentPlugin', {}, []);
    } catch (error) {
      errorThrown = true;
      expect(error).toBeInstanceOf(Error);
    }
    expect(errorThrown).toBe(true);
  });
  
  it('handles asynchronous operations', async () => {
    const input = await context.execute('NumberSource', { value: 7 }, []);
    const result = await context.execute('AsyncCompute', { delay: 10 }, [input]);
    expect(result).toBe(14);
  });
  
  it('executes task via executeTask method', async () => {
    const task = {
      nodeType: 'NumberSource',
      config: { value: 25 },
      inputs: []
    };
    const result = await context.executeTask(task);
    expect(result).toBe(25);
  });
  
  it('terminate works without errors', () => {
    expect(() => context.terminate()).not.toThrow();
  });
}); 