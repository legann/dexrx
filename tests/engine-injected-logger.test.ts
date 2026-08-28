import { ReactiveGraphEngine } from '../lib/dexrx/src/engine/engine';
import { NodeRegistry } from '../lib/dexrx/src/engine/registry';
import { ConsoleLoggerAdapter } from '../lib/dexrx/src/utils/logging/console-logger-adapter';
import { LoggerAdapter } from '../lib/dexrx/src/utils/logging/logger-adapter';
import { LogLevel } from '../lib/dexrx/src/types/logger';

describe('ReactiveGraphEngine — injected logger', () => {
  it('uses an injected ConsoleLoggerAdapter instance for its own logs', () => {
    const injected = new ConsoleLoggerAdapter();
    injected.setLevel(LogLevel.OFF);
    const engine = new ReactiveGraphEngine(new NodeRegistry(), { logger: injected });
    expect((engine as unknown as { logger: ConsoleLoggerAdapter }).logger).toBe(injected);
    engine.destroy();
  });

  it('mirrors another LoggerAdapter level onto its console adapter', () => {
    class TestAdapter extends LoggerAdapter {
      log(): void {
        /* no-op */
      }
    }
    const injected = new TestAdapter();
    injected.setLevel(LogLevel.OFF);
    const engine = new ReactiveGraphEngine(new NodeRegistry(), { logger: injected });
    const used = (engine as unknown as { logger: ConsoleLoggerAdapter }).logger;
    expect(used).not.toBe(injected);
    expect(used).toBeInstanceOf(ConsoleLoggerAdapter);
    expect(used.getLevel()).toBe(LogLevel.OFF);
    engine.destroy();
  });
});
