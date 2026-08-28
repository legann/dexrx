import { Subject } from 'rxjs';
import { ReactiveGraphEngine } from '../lib/dexrx/src/engine/engine';
import { NodeRegistry } from '../lib/dexrx/src/engine/registry';
import { createNodeWrapper } from '../lib/dexrx/src/engine/node';
import { NodeConfig } from '../lib/dexrx/src/types/utils';
import { ExecutionContext } from '../lib/dexrx/src/types/execution-context';

// The pipeline resolves inputs via mergeMap(Promise.all(...)), so each tick crosses
// a microtask boundary; a zero timer drains the whole chain deterministically.
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

type PrivateEngine = {
  controlSlots: Map<string, NodeConfig>;
  controlRoutingSubs: Map<string, unknown>;
};

/**
 * Builds the canonical control-loop graph: src -> filter -> controller,
 * where the controller pushes threshold deltas back into the filter's
 * control-slot (a data-DAG back-link would be a cycle; the control link is not).
 */
function buildLoop(opts?: {
  controllerCompute?: (config: NodeConfig, inputs: readonly unknown[]) => unknown;
  controls?: readonly string[];
}) {
  const registry = new NodeRegistry();
  const src = new Subject<unknown>();
  const filterCalls: Array<{ threshold: unknown; input: unknown }> = [];
  const controllerCalls: unknown[] = [];

  registry.register({
    type: 'src',
    category: 'data',
    compute: () => src.asObservable(),
  });
  registry.register({
    type: 'filter',
    category: 'operational',
    compute: (config, inputs) => {
      filterCalls.push({ threshold: config.threshold, input: inputs[0] });
      return (inputs[0] as number) >= (config.threshold as number);
    },
  });
  registry.register({
    type: 'controller',
    category: 'operational',
    compute: (config, inputs) => {
      controllerCalls.push(inputs[0]);
      return opts?.controllerCompute
        ? opts.controllerCompute(config, inputs)
        : { threshold: 5 };
    },
  });

  // The engine auto-starts by default; nodes added while RUNNING wire up immediately.
  const engine = new ReactiveGraphEngine(registry);
  engine.addNode({ id: 's', type: 'src' });
  engine.addNode({ id: 'f', type: 'filter', config: { threshold: 50 }, inputs: ['s'] });
  engine.addNode({
    id: 'c',
    type: 'controller',
    inputs: ['f'],
    controls: opts?.controls ?? ['f'],
  });

  return { engine, src, filterCalls, controllerCalls };
}

describe('feedback control-channel — phase 1 (push, non-triggering)', () => {
  it('builds the downstream→upstream control link without a cycle error, while a data cycle still throws', () => {
    const { engine } = buildLoop();
    // Graph built fine above (controls:['f'] points back upstream). Control: a real
    // data cycle must still be rejected — detectCycle is untouched by the channel.
    expect(() =>
      engine.updateNode('s', { id: 's', type: 'src', inputs: ['c'] })
    ).toThrow(/Cycle detected/);
    engine.destroy();
  });

  it('push does NOT trigger the target; the delta applies on the target’s next data tick', async () => {
    const { engine, src, filterCalls } = buildLoop();

    src.next(60);
    await flush();

    // One tick: filter computed once on the BASE config (empty slot = base config).
    expect(filterCalls).toEqual([{ threshold: 50, input: 60 }]);

    // The controller has already emitted {threshold: 5} into the slot during this tick,
    // but the write itself must not recompute the filter.
    await flush();
    expect(filterCalls).toHaveLength(1);

    // Next data tick: the filter sees the merged effectiveConfig.
    src.next(60);
    await flush();
    expect(filterCalls).toHaveLength(2);
    expect(filterCalls[1]).toEqual({ threshold: 5, input: 60 });

    engine.destroy();
  });

  it('does not mutate the target’s base def.config (override, not mutate)', async () => {
    const { engine, src } = buildLoop();

    src.next(60);
    await flush();
    src.next(60);
    await flush();

    const state = engine.exportState();
    expect(state.nodes['f']?.config?.threshold).toBe(50);

    engine.destroy();
  });

  it('ignores non-object controller payloads (no slot write)', async () => {
    const { engine, src, filterCalls } = buildLoop({
      controllerCompute: () => 42, // number, not a config delta
    });

    src.next(60);
    await flush();
    src.next(60);
    await flush();

    // Both ticks on the base config: nothing was routed into the slot.
    expect(filterCalls.map(c => c.threshold)).toEqual([50, 50]);
    expect((engine as unknown as PrivateEngine).controlSlots.size).toBe(0);

    engine.destroy();
  });

  it('supports the imperative __setControl writer for dynamic targets (controls: [])', async () => {
    const { engine, src, filterCalls } = buildLoop({
      controls: [],
      controllerCompute: config => {
        config.__setControl?.('f', { threshold: 7 });
        return 'pushed';
      },
    });

    src.next(60);
    await flush();
    src.next(60);
    await flush();

    expect(filterCalls.map(c => c.threshold)).toEqual([50, 7]);

    engine.destroy();
  });

  it('strips __setControl from exported node config; controls survives export', () => {
    const { engine } = buildLoop();

    const state = engine.exportState();
    expect(state.nodes['c']?.config ?? {}).not.toHaveProperty('__setControl');
    // controls survives export as part of the definition (restart must not lose the loop)
    expect(state.nodes['c']?.controls).toEqual(['f']);

    engine.destroy();
  });

  it('restores the control loop after exportState → importState (restart warm-up)', async () => {
    const first = buildLoop();
    first.src.next(60);
    await flush();
    const snapshot = first.engine.exportState();
    first.engine.destroy();

    // Fresh engine + registry with a controllable source, same plugin types.
    const registry = new NodeRegistry();
    const src2 = new Subject<unknown>();
    const filterCalls: Array<{ threshold: unknown }> = [];
    registry.register({ type: 'src', category: 'data', compute: () => src2.asObservable() });
    registry.register({
      type: 'filter',
      category: 'operational',
      compute: (config, inputs) => {
        filterCalls.push({ threshold: config.threshold });
        return (inputs[0] as number) >= (config.threshold as number);
      },
    });
    registry.register({
      type: 'controller',
      category: 'operational',
      compute: () => ({ threshold: 5 }),
    });

    const engine = new ReactiveGraphEngine(registry);
    await engine.importState(snapshot);

    // Slots are not serialized, but the controller's currentValue IS: restoring it
    // re-emits the last payload through the restored routing subscription, so the
    // slot comes back for free — no warm-up tick on the base config.
    const internals = engine as unknown as PrivateEngine;
    expect(internals.controlSlots.get('f')).toEqual({ threshold: 5 });

    engine.start();
    src2.next(60);
    await flush();
    expect(filterCalls[0]).toEqual({ threshold: 5 });

    engine.destroy();
  });

  it('tears down the routing subscription and the slot on node removal', async () => {
    const { engine, src } = buildLoop();
    const internals = engine as unknown as PrivateEngine;

    src.next(60);
    await flush();
    expect(internals.controlRoutingSubs.has('c')).toBe(true);
    expect(internals.controlSlots.has('f')).toBe(true);

    engine.removeNode('c');
    expect(internals.controlRoutingSubs.has('c')).toBe(false);

    engine.removeNode('f');
    expect(internals.controlSlots.has('f')).toBe(false);

    engine.destroy();
    expect(internals.controlSlots.size).toBe(0);
    expect(internals.controlRoutingSubs.size).toBe(0);
  });

  it('re-creates routing from the NEW definition on updateNode (retargeting)', async () => {
    const { engine, src, filterCalls } = buildLoop();
    const internals = engine as unknown as PrivateEngine;

    src.next(60);
    await flush();
    expect(internals.controlSlots.has('f')).toBe(true);

    // Retarget the controller away from 'f' — the old routing must not fire anymore.
    engine.updateNode('c', { id: 'c', type: 'controller', inputs: ['f'], controls: [] });
    internals.controlSlots.delete('f'); // reset for a clean observation

    src.next(60);
    await flush();
    expect(internals.controlSlots.has('f')).toBe(false);
    // Filter runs on the base config again (slot was cleared and never re-written).
    expect(filterCalls[filterCalls.length - 1].threshold).toBe(50);

    engine.destroy();
  });

  it('broadcasts one delta into every declared target (multi-target)', async () => {
    const registry = new NodeRegistry();
    const src = new Subject<unknown>();
    const seen: Array<{ tag: unknown; threshold: unknown }> = [];
    registry.register({ type: 'src', category: 'data', compute: () => src.asObservable() });
    registry.register({
      type: 'filter',
      category: 'operational',
      compute: (config, inputs) => {
        seen.push({ tag: config.tag, threshold: config.threshold });
        return inputs[0];
      },
    });
    registry.register({
      type: 'controller',
      category: 'operational',
      compute: () => ({ threshold: 5 }),
    });

    const engine = new ReactiveGraphEngine(registry);
    engine.addNode({ id: 's', type: 'src' });
    engine.addNode({ id: 'f1', type: 'filter', config: { tag: 'f1', threshold: 50 }, inputs: ['s'] });
    engine.addNode({ id: 'f2', type: 'filter', config: { tag: 'f2', threshold: 40 }, inputs: ['s'] });
    engine.addNode({ id: 'c', type: 'controller', inputs: ['f1'], controls: ['f1', 'f2'] });

    src.next(60);
    await flush();
    src.next(60);
    await flush();

    // Second tick: BOTH targets see the same broadcast delta over their own base.
    const second = seen.filter((_, i) => i >= 2);
    expect(second).toEqual(
      expect.arrayContaining([
        { tag: 'f1', threshold: 5 },
        { tag: 'f2', threshold: 5 },
      ])
    );

    engine.destroy();
  });

  it('accumulates slot keys across pushes (cross-key union, not replace)', async () => {
    let delta: NodeConfig = { a: 1 };
    const { engine, src, filterCalls } = buildLoop({ controllerCompute: () => delta });
    const internals = engine as unknown as PrivateEngine;

    src.next(60);
    await flush();
    expect(internals.controlSlots.get('f')).toEqual({ a: 1 });

    delta = { b: 2 };
    src.next(60);
    await flush();
    // Per-key merge: disjoint keys form a union — a wholesale replace would drop 'a'.
    expect(internals.controlSlots.get('f')).toEqual({ a: 1, b: 2 });

    src.next(60);
    await flush();
    const last = filterCalls[filterCalls.length - 1] as unknown as Record<string, unknown>;
    expect(last.threshold).toBe(50); // base untouched by unrelated keys

    engine.destroy();
  });

  it('does NOT re-broadcast the stale payload on updateNode retarget (warm-up on next emission)', async () => {
    const { engine, src } = buildLoop();
    const internals = engine as unknown as PrivateEngine;

    src.next(60);
    await flush();
    expect(internals.controlSlots.get('f')).toEqual({ threshold: 5 });

    // Add a second potential target and retarget the controller to it.
    engine.addNode({ id: 'g', type: 'filter', config: { threshold: 70 }, inputs: ['s'] });
    engine.updateNode('c', { id: 'c', type: 'controller', inputs: ['f'], controls: ['g'] });

    // The BehaviorSubject replay is skipped: 'g' must NOT be seeded with the stale
    // payload computed for the old target set.
    expect(internals.controlSlots.has('g')).toBe(false);

    // The next real emission warms the new target up.
    src.next(60);
    await flush();
    expect(internals.controlSlots.get('g')).toEqual({ threshold: 5 });

    engine.destroy();
  });

  it('removeNode(target) drops the slot for good: no zombie resurrection, re-add starts on base config', async () => {
    const { engine, src, filterCalls } = buildLoop();
    const internals = engine as unknown as PrivateEngine;

    src.next(60);
    await flush();
    expect(internals.controlSlots.get('f')).toEqual({ threshold: 5 });

    engine.removeNode('f');
    expect(internals.controlSlots.has('f')).toBe(false);
    // The dependents rewire also stripped 'f' from the controller's controls,
    // so no routing keeps broadcasting at the dead id.
    const cDef = (engine as unknown as { defs: Map<string, { controls?: readonly string[] }> }).defs.get('c');
    expect(cDef?.controls ?? []).toEqual([]);

    // Re-add a node under the same id: its first compute runs on the BASE config.
    engine.addNode({ id: 'f', type: 'filter', config: { threshold: 50 }, inputs: ['s'] });
    src.next(60);
    await flush();
    expect(internals.controlSlots.has('f')).toBe(false);
    expect(filterCalls[filterCalls.length - 1].threshold).toBe(50);

    engine.destroy();
  });

  it('keeps the slot across updateNode of the TARGET (overlay applies to the new base)', async () => {
    const { engine, src, filterCalls } = buildLoop();

    src.next(60);
    await flush();

    engine.updateNode('f', { id: 'f', type: 'filter', config: { threshold: 80 }, inputs: ['s'] });
    src.next(60);
    await flush();

    // Slot survives target redefinition and overlays the NEW base…
    expect(filterCalls[filterCalls.length - 1].threshold).toBe(5);
    // …while the new base itself stays clean.
    expect(engine.exportState().nodes['f']?.config?.threshold).toBe(80);

    engine.destroy();
  });

  it('strips __setControl from a controller that HAS a config (exportState + exportGraph)', async () => {
    const registry = new NodeRegistry();
    const src = new Subject<unknown>();
    registry.register({ type: 'src', category: 'data', compute: () => src.asObservable() });
    registry.register({ type: 'controller', category: 'operational', compute: () => ({ x: 1 }) });

    const engine = new ReactiveGraphEngine(registry);
    engine.addNode({ id: 's', type: 'src' });
    // Config present: the wrapper shares the stored def.config reference, so the
    // injected __setControl lands INSIDE the stored definition — exports must strip it.
    engine.addNode({ id: 'c', type: 'controller', config: { gain: 1 }, inputs: ['s'], controls: [] });

    const state = engine.exportState();
    expect(state.nodes['c']?.config?.gain).toBe(1);
    expect(state.nodes['c']?.config ?? {}).not.toHaveProperty('__setControl');

    const graph = engine.exportGraph();
    const cNode = graph.nodes.find(n => n.id === 'c');
    expect(cNode?.config?.gain).toBe(1);
    expect(cNode?.config ?? {}).not.toHaveProperty('__setControl');
    expect(cNode?.controls).toEqual([]);

    engine.destroy();
  });

  it('revokes __setControl when its owner node is removed', async () => {
    let stash: ((id: string, delta: NodeConfig) => void) | undefined;
    const { engine, src } = buildLoop({
      controls: [],
      controllerCompute: config => {
        stash = config.__setControl;
        return 'noop';
      },
    });
    const internals = engine as unknown as PrivateEngine;

    src.next(60);
    await flush();
    expect(typeof stash).toBe('function');

    engine.removeNode('c');
    stash?.('f', { threshold: 123 });
    // A plugin-retained writer must not steer live targets after its node is gone.
    expect(internals.controlSlots.get('f') ?? {}).not.toHaveProperty('threshold');

    engine.destroy();
  });

  it('applies a shallow per-top-level-key merge (nested objects replaced wholesale)', async () => {
    const registry = new NodeRegistry();
    const src = new Subject<unknown>();
    const seen: unknown[] = [];
    registry.register({ type: 'src', category: 'data', compute: () => src.asObservable() });
    registry.register({
      type: 'filter',
      category: 'operational',
      compute: (config, inputs) => {
        seen.push({ mode: config.mode, nested: config.nested });
        return inputs[0];
      },
    });
    registry.register({
      type: 'controller',
      category: 'operational',
      compute: () => ({ nested: { a: 1 } }),
    });

    const engine = new ReactiveGraphEngine(registry);
    engine.addNode({ id: 's', type: 'src' });
    engine.addNode({
      id: 'f',
      type: 'filter',
      config: { mode: 'x', nested: { a: 0, b: 9 } },
      inputs: ['s'],
    });
    engine.addNode({ id: 'c', type: 'controller', inputs: ['f'], controls: ['f'] });

    src.next(60);
    await flush();
    src.next(60);
    await flush();

    // Top-level key 'nested' replaced wholesale (b gone); untouched keys preserved.
    expect(seen[1]).toEqual({ mode: 'x', nested: { a: 1 } });

    engine.destroy();
  });

  it('slot deltas pass the built-in deepSanitize when sanitizeInput is on (no side door)', async () => {
    const registry = new NodeRegistry();
    const src = new Subject<unknown>();
    registry.register({ type: 'src', category: 'data', compute: () => src.asObservable() });
    registry.register({ type: 'filter', category: 'operational', compute: (_c, i) => i[0] });
    registry.register({
      type: 'controller',
      category: 'operational',
      compute: () => ({ label: '<script>alert(1)</script>', threshold: 5 }),
    });

    const engine = new ReactiveGraphEngine(registry, { sanitizeInput: true });
    engine.addNode({ id: 's', type: 'src' });
    engine.addNode({ id: 'f', type: 'filter', config: { threshold: 50 }, inputs: ['s'] });
    engine.addNode({ id: 'c', type: 'controller', inputs: ['f'], controls: ['f'] });

    src.next(60);
    await flush();

    const slot = (engine as unknown as PrivateEngine).controlSlots.get('f') ?? {};
    // The overlay went through the SAME InputGuardService.deepSanitize as base configs:
    // dangerous characters are stripped, clean values pass untouched.
    expect(slot.threshold).toBe(5);
    expect(String(slot.label)).not.toMatch(/[<>]/);

    engine.destroy();
  });

  it('does not pollute Object.prototype via a JSON-parsed __proto__ payload', async () => {
    const { engine, src } = buildLoop({
      controllerCompute: () => JSON.parse('{"threshold":1,"__proto__":{"polluted":true}}'),
    });
    const internals = engine as unknown as PrivateEngine;

    src.next(60);
    await flush();

    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.keys(internals.controlSlots.get('f') ?? {})).toEqual(['threshold']);

    engine.destroy();
  });

  it('ParallelNodeWrapper overlays the slot and strips __setControl before execute', () => {
    const calls: Array<{ config: NodeConfig }> = [];
    const fakeContext = {
      execute: (_type: string, config: NodeConfig) => {
        calls.push({ config });
        return Promise.resolve('ok');
      },
      terminate: () => undefined,
    } as unknown as ExecutionContext;

    const plugin = { type: 'p', category: 'operational' as const, compute: () => 0 };

    // With a slot: overlay applied, both control writers stripped from the outgoing config.
    const base: NodeConfig = {
      threshold: 50,
      __setControl: () => undefined,
      __requestConfigUpdate: () => undefined,
    };
    const wrapper = createNodeWrapper(plugin, base, fakeContext, () => ({ threshold: 7 }));
    wrapper.compute([1]);
    expect(calls[0].config.threshold).toBe(7);
    expect(calls[0].config).not.toHaveProperty('__setControl');
    expect(calls[0].config).not.toHaveProperty('__requestConfigUpdate');

    // Empty slot on a plain config: the SAME reference goes through (zero cost).
    const plain: NodeConfig = { threshold: 50 };
    const wrapper2 = createNodeWrapper(plugin, plain, fakeContext, () => undefined);
    wrapper2.compute([1]);
    expect(calls[1].config).toBe(plain);
  });

  it('a push while PAUSED lands in the slot and applies after resume', async () => {
    const { engine, src, filterCalls } = buildLoop({ controls: [] });
    const internals = engine as unknown as PrivateEngine;

    src.next(60);
    await flush();

    engine.pause();
    // Imperative push while paused: slot armed, nothing computes.
    const wrapper = (engine as unknown as { wrappers: Map<string, { config: NodeConfig }> }).wrappers.get('c');
    wrapper?.config.__setControl?.('f', { threshold: 9 });
    expect(internals.controlSlots.get('f')).toEqual({ threshold: 9 });
    const computedWhilePaused = filterCalls.length;

    engine.resume();
    expect(filterCalls.length).toBe(computedWhilePaused);

    src.next(60);
    await flush();
    expect(filterCalls[filterCalls.length - 1].threshold).toBe(9);

    engine.destroy();
  });

  it('addressed __targets payload routes a distinct delta to each declared target', async () => {
    const registry = new NodeRegistry();
    const src = new Subject<unknown>();
    const seen: Array<{ tag: unknown; threshold: unknown }> = [];
    registry.register({ type: 'src', category: 'data', compute: () => src.asObservable() });
    registry.register({
      type: 'filter',
      category: 'operational',
      compute: (config, inputs) => {
        seen.push({ tag: config.tag, threshold: config.threshold });
        return inputs[0];
      },
    });
    registry.register({
      type: 'controller',
      category: 'operational',
      compute: () => ({
        __targets: {
          f1: { threshold: 11, __targets: { smuggled: true } }, // nested marker must not reach the slot
          f2: { threshold: 22 },
          ghost: { threshold: 99 }, // NOT declared in controls -> dropped
        },
      }),
    });

    const engine = new ReactiveGraphEngine(registry);
    engine.addNode({ id: 's', type: 'src' });
    engine.addNode({ id: 'f1', type: 'filter', config: { tag: 'f1', threshold: 50 }, inputs: ['s'] });
    engine.addNode({ id: 'f2', type: 'filter', config: { tag: 'f2', threshold: 40 }, inputs: ['s'] });
    engine.addNode({ id: 'c', type: 'controller', inputs: ['f1'], controls: ['f1', 'f2'] });
    const internals = engine as unknown as PrivateEngine;

    src.next(60);
    await flush();

    expect(internals.controlSlots.get('f1')).toEqual({ threshold: 11 });
    expect(internals.controlSlots.get('f2')).toEqual({ threshold: 22 });
    expect(internals.controlSlots.has('ghost')).toBe(false);

    src.next(60);
    await flush();
    const second = seen.filter((_, i) => i >= 2);
    expect(second).toEqual(
      expect.arrayContaining([
        { tag: 'f1', threshold: 11 },
        { tag: 'f2', threshold: 22 },
      ])
    );

    engine.destroy();
  });

  it('addressed payload ignores non-object __targets and non-object deltas; other keys are not broadcast', async () => {
    let payload: unknown = { __targets: 'not-an-object', threshold: 5 };
    const { engine, src } = buildLoop({ controllerCompute: () => payload });
    const internals = engine as unknown as PrivateEngine;

    src.next(60);
    await flush();
    // Marker present but invalid -> whole payload ignored (threshold NOT broadcast).
    expect(internals.controlSlots.size).toBe(0);

    payload = { __targets: { f: 42 } }; // delta is not an object
    src.next(60);
    await flush();
    expect(internals.controlSlots.size).toBe(0);

    // Valid map + DISJOINT stray key: the stray key must NOT be broadcast alongside
    // the addressed routing (kills the "addressed + broadcast leftovers" mutant).
    payload = { __targets: { f: { threshold: 7 } }, gain: 5 };
    src.next(60);
    await flush();
    expect(internals.controlSlots.get('f')).toEqual({ threshold: 7 });

    // Empty map: marker present -> addressed path -> zero routes, NOT a broadcast
    // fallthrough; existing slot contents stay untouched.
    payload = { __targets: {} };
    src.next(60);
    await flush();
    expect(internals.controlSlots.get('f')).toEqual({ threshold: 7 });
    expect(internals.controlSlots.size).toBe(1);

    // Addressed deltas MERGE per key into the existing slot (same rule as broadcast).
    payload = { __targets: { f: { mode: 'x' } } };
    src.next(60);
    await flush();
    expect(internals.controlSlots.get('f')).toEqual({ threshold: 7, mode: 'x' });

    engine.destroy();
  });

  it('two controllers on one target: disjoint keys form a union; same key = one owner convention', async () => {
    const registry = new NodeRegistry();
    const src = new Subject<unknown>();
    registry.register({ type: 'src', category: 'data', compute: () => src.asObservable() });
    registry.register({
      type: 'filter',
      category: 'operational',
      compute: (_c, inputs) => inputs[0],
    });
    registry.register({
      type: 'ctrl-a',
      category: 'operational',
      compute: () => ({ threshold: 1 }),
    });
    registry.register({
      type: 'ctrl-b',
      category: 'operational',
      compute: () => ({ mode: 'strict', threshold: 2 }),
    });

    const engine = new ReactiveGraphEngine(registry);
    engine.addNode({ id: 's', type: 'src' });
    engine.addNode({ id: 'f', type: 'filter', config: { threshold: 50 }, inputs: ['s'] });
    engine.addNode({ id: 'c1', type: 'ctrl-a', inputs: ['f'], controls: ['f'] });
    engine.addNode({ id: 'c2', type: 'ctrl-b', inputs: ['f'], controls: ['f'] });
    const internals = engine as unknown as PrivateEngine;

    src.next(60);
    await flush();

    const slot = internals.controlSlots.get('f') ?? {};
    // Disjoint keys accumulate across controllers (per-key merge) — 'mode' is owned
    // by c2 alone and must survive alongside 'threshold'.
    expect(slot.mode).toBe('strict');
    // Same key from two controllers: LAST DELIVERY wins. Deterministic today
    // (subscription order follows node-addition order), but UNSPECIFIED as a
    // contract — the supported form is "one key, one owner"; coordination goes
    // through a single controller with addressed __targets, or an arbiter node.
    expect([1, 2]).toContain(slot.threshold);

    engine.destroy();
  });

  it('a controller with controls:[] cannot address via __targets (no routing subscription)', async () => {
    const { engine, src } = buildLoop({
      controls: [],
      controllerCompute: () => ({ __targets: { f: { threshold: 7 } } }),
    });
    const internals = engine as unknown as PrivateEngine;

    src.next(60);
    await flush();
    // controls:[] declares only the imperative writer; broadcast/addressed routing
    // requires declared targets.
    expect(internals.controlSlots.size).toBe(0);

    engine.destroy();
  });

  it('restores DISTINCT addressed per-target slots via the snapshot (not just the last payload)', async () => {
    const registry = new NodeRegistry();
    const src = new Subject<unknown>();
    registry.register({ type: 'src', category: 'data', compute: () => src.asObservable() });
    registry.register({
      type: 'filter',
      category: 'operational',
      compute: (_c, inputs) => inputs[0],
    });
    let tick = 0;
    registry.register({
      type: 'controller',
      category: 'operational',
      compute: () => {
        tick++;
        // Emission 1 addresses only f1; emission 2 only f2; then 'hold'. The LAST
        // payload covers neither f1 nor both — only the serialized slots restore all.
        if (tick === 1) return { __targets: { f1: { threshold: 11 } } };
        if (tick === 2) return { __targets: { f2: { threshold: 22 } } };
        return 'hold';
      },
    });

    const engine = new ReactiveGraphEngine(registry);
    engine.addNode({ id: 's', type: 'src' });
    engine.addNode({ id: 'f1', type: 'filter', config: { threshold: 50 }, inputs: ['s'] });
    engine.addNode({ id: 'f2', type: 'filter', config: { threshold: 40 }, inputs: ['s'] });
    engine.addNode({ id: 'c', type: 'controller', inputs: ['f1'], controls: ['f1', 'f2'] });

    src.next(60);
    await flush();
    src.next(60);
    await flush();
    src.next(60);
    await flush();

    const internals = engine as unknown as PrivateEngine;
    expect(internals.controlSlots.get('f1')).toEqual({ threshold: 11 });
    expect(internals.controlSlots.get('f2')).toEqual({ threshold: 22 });
    const snapshot = engine.exportState();
    expect(snapshot.controlSlots).toEqual({
      f1: { threshold: 11 },
      f2: { threshold: 22 },
    });
    engine.destroy();

    // Fresh engine: the last emission was 'hold', so the currentValue replay restores
    // nothing — the serialized slots must carry BOTH distinct deltas.
    const engine2 = new ReactiveGraphEngine(registry);
    await engine2.importState(snapshot);
    const internals2 = engine2 as unknown as PrivateEngine;
    expect(internals2.controlSlots.get('f1')).toEqual({ threshold: 11 });
    expect(internals2.controlSlots.get('f2')).toEqual({ threshold: 22 });
    engine2.destroy();
  });

  it('exportGraph → importGraph rebuilds the loop with cold slots and live routing', async () => {
    const first = buildLoop();
    first.src.next(60);
    await flush();
    const graphDef = first.engine.exportGraph();
    first.engine.destroy();

    const registry = new NodeRegistry();
    const src2 = new Subject<unknown>();
    const filterCalls: Array<{ threshold: unknown }> = [];
    registry.register({ type: 'src', category: 'data', compute: () => src2.asObservable() });
    registry.register({
      type: 'filter',
      category: 'operational',
      compute: (config, inputs) => {
        filterCalls.push({ threshold: config.threshold });
        return inputs[0];
      },
    });
    registry.register({
      type: 'controller',
      category: 'operational',
      compute: () => ({ threshold: 5 }),
    });

    const engine = new ReactiveGraphEngine(registry);
    engine.importGraph(graphDef);
    const internals = engine as unknown as PrivateEngine;
    // Structure-only export: slots are cold until the controller's first emission.
    expect(internals.controlSlots.size).toBe(0);

    src2.next(60);
    await flush();
    expect(filterCalls[0]).toEqual({ threshold: 50 }); // base config, cold slot
    expect(internals.controlSlots.get('f')).toEqual({ threshold: 5 }); // routing is live

    src2.next(60);
    await flush();
    expect(filterCalls[1]).toEqual({ threshold: 5 });

    engine.destroy();
  });

  it('merges repeated pushes per key (last-write-wins) and keeps runtime fields out of the slot', async () => {
    let delta: NodeConfig = { threshold: 10, __subject: 'evil', __runtime: { nodeId: 'x' } };
    const { engine, src, filterCalls } = buildLoop({
      controllerCompute: () => delta,
    });
    const internals = engine as unknown as PrivateEngine;

    src.next(60);
    await flush();
    // Runtime fields never reach the slot — a controller cannot overwrite __subject.
    expect(internals.controlSlots.get('f')).toEqual({ threshold: 10 });

    delta = { threshold: 20 };
    src.next(60);
    await flush();
    expect(internals.controlSlots.get('f')).toEqual({ threshold: 20 });

    src.next(60);
    await flush();
    expect(filterCalls[filterCalls.length - 1].threshold).toBe(20);

    engine.destroy();
  });
});
