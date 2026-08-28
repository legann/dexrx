import { ReactiveGraphEngine } from '../lib/dexrx/src/engine/engine';
import { NodeRegistry } from '../lib/dexrx/src/engine/registry';

describe('ReactiveGraphEngine — distinctUntilChanged value equality', () => {
  // The distinctValues comparator must not throw on non-serializable inputs (BigInt,
  // circular references); a throwing comparator would terminate the node's subscription.
  it('safeJsonEqual returns false on BigInt / circular inputs instead of throwing', () => {
    const engine = new ReactiveGraphEngine(new NodeRegistry());
    const eq = (
      engine as unknown as { safeJsonEqual(a: unknown, b: unknown): boolean }
    ).safeJsonEqual.bind(engine);

    expect(eq(1, 1)).toBe(true);
    expect(eq({ a: 1 }, { a: 1 })).toBe(true);
    expect(eq(1, 2)).toBe(false);

    expect(() => eq(1n, 1n)).not.toThrow();
    expect(eq(1n, 1n)).toBe(false);

    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => eq(circular, circular)).not.toThrow();

    engine.destroy();
  });
});
