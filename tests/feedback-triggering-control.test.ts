import { Subject } from 'rxjs';
import { ReactiveGraphEngine } from '../lib/dexrx/src/engine/engine';
import { NodeRegistry } from '../lib/dexrx/src/engine/registry';
import { EngineEventType } from '../lib/dexrx/src/types/engine-hooks';
import { createGraph } from '../lib/dexrx/src/graph';
import { withNodesConfig } from '../lib/dexrx/src/operators';
import { INodePlugin } from '../lib/dexrx/src/types/node-plugin';
import { NodeConfig } from '../lib/dexrx/src/types/utils';

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function buildEngine() {
  const registry = new NodeRegistry();
  const src = new Subject<unknown>();
  const filterCalls: Array<{ threshold: unknown; input: unknown }> = [];

  registry.register({ type: 'src', category: 'data', compute: () => src.asObservable() });
  registry.register({
    type: 'filter',
    category: 'operational',
    compute: (config, inputs) => {
      filterCalls.push({ threshold: config.threshold, input: inputs[0] });
      return (inputs[0] as number) >= (config.threshold as number);
    },
  });

  const engine = new ReactiveGraphEngine(registry);
  engine.addNode({ id: 's', type: 'src' });
  engine.addNode({ id: 'f', type: 'filter', config: { threshold: 50 }, inputs: ['s'] });
  return { engine, src, filterCalls };
}

describe('triggering control — requestConfigUpdate (phase 3)', () => {
  it('recomputes the target immediately on the replayed inputs, without a new data tick', async () => {
    const { engine, src, filterCalls } = buildEngine();

    src.next(60);
    await delay(10);
    expect(filterCalls).toEqual([{ threshold: 50, input: 60 }]);

    // No new data tick — updateNode re-wires combineLatest over BehaviorSubjects,
    // which replay their latest values: the filter recomputes with the new config.
    engine.requestConfigUpdate('f', { threshold: 5 });
    await delay(10);
    expect(filterCalls).toHaveLength(2);
    expect(filterCalls[1]).toEqual({ threshold: 5, input: 60 });

    // Unlike the non-triggering slot, the BASE config is rewritten.
    expect(engine.exportState().nodes['f']?.config?.threshold).toBe(5);

    engine.destroy();
  });

  it('coalesces calls inside the rate window into ONE trailing update (runaway guard)', async () => {
    const { engine, src, filterCalls } = buildEngine();
    let updates = 0;
    engine.on(EngineEventType.NODE_UPDATED, () => {
      updates++;
    });

    src.next(60);
    await delay(10);
    const baselineComputes = filterCalls.length;

    // A burst of pushes within one 60ms window: one updateNode, merged delta.
    for (let i = 1; i <= 5; i++) {
      engine.requestConfigUpdate('f', { threshold: i, [`k${i}`]: i }, { minIntervalMs: 60 });
    }
    await delay(30);
    expect(updates).toBe(1);
    expect(engine.exportState().nodes['f']?.config?.threshold).toBe(5); // last write per key
    expect(engine.exportState().nodes['f']?.config?.k1).toBe(1); // earlier keys survived the merge
    expect(filterCalls.length).toBe(baselineComputes + 1); // exactly one recompute for the burst

    // After the window: a new push applies as a second update.
    await delay(70);
    engine.requestConfigUpdate('f', { threshold: 9 }, { minIntervalMs: 60 });
    await delay(30);
    expect(updates).toBe(2);
    expect(engine.exportState().nodes['f']?.config?.threshold).toBe(9);

    engine.destroy();
  });

  it('drops a pending update if the target is removed before the flush', async () => {
    const { engine, src } = buildEngine();
    let updates = 0;
    engine.on(EngineEventType.NODE_UPDATED, () => {
      updates++;
    });

    src.next(60);
    await delay(10);

    engine.requestConfigUpdate('f', { threshold: 5 }, { minIntervalMs: 50 });
    engine.removeNode('f');
    await delay(80);
    expect(updates).toBe(0);

    engine.destroy();
  });

  it('cancels pending updates on destroy (no posthumous updateNode)', async () => {
    const { engine, src } = buildEngine();
    let updates = 0;
    engine.on(EngineEventType.NODE_UPDATED, () => {
      updates++;
    });

    src.next(60);
    await delay(10);

    engine.requestConfigUpdate('f', { threshold: 5 }, { minIntervalMs: 30 });
    engine.destroy();
    await delay(60);
    expect(updates).toBe(0);
  });

  it('coalesces across a PAUSED window: deltas merge, none clobbered by the resume replay', async () => {
    const { engine, src } = buildEngine();
    let updates = 0;
    engine.on(EngineEventType.NODE_UPDATED, () => {
      updates++;
    });

    src.next(60);
    await delay(10);

    engine.pause();
    // Two pushes while paused, in separate macrotasks (the first flush fires PAUSED
    // and must NOT fall through into updateNode's wholesale resume-replay slot —
    // that would let the second delta clobber the first).
    engine.requestConfigUpdate('f', { threshold: 5 });
    await delay(20);
    engine.requestConfigUpdate('f', { mode: 'strict' });
    await delay(20);
    expect(updates).toBe(0); // nothing applied while paused

    engine.resume();
    await delay(120); // paused-flush retries at 50ms

    const config = engine.exportState().nodes['f']?.config ?? {};
    expect(config.threshold).toBe(5); // first delta survived
    expect(config.mode).toBe('strict'); // merged with the second
    expect(updates).toBe(1); // ONE coalesced update, not two

    engine.destroy();
  });

  it('ignores non-object deltas and strips runtime fields from the applied delta', async () => {
    const { engine, src } = buildEngine();

    src.next(60);
    await delay(10);

    engine.requestConfigUpdate('f', 42 as never);
    const hostileDelta = JSON.parse('{"threshold":5,"__subject":"evil","__setControl":"evil"}');
    engine.requestConfigUpdate('f', hostileDelta);
    await delay(10);

    const config = engine.exportState().nodes['f']?.config ?? {};
    expect(config.threshold).toBe(5);
    expect(config).not.toHaveProperty('__subject');
    expect(config).not.toHaveProperty('__setControl');

    engine.destroy();
  });

  it('is exposed on the long-running Build API graph and safe to call from a subscription handler', async () => {
    const stream = new Subject<unknown>();
    const filterCalls: Array<{ threshold: unknown }> = [];
    const wsPlugin: INodePlugin = {
      type: 'ws',
      category: 'data',
      compute: () => stream.asObservable(),
    };
    const filterPlugin: INodePlugin = {
      type: 'filter',
      category: 'operational',
      compute: (config, inputs) => {
        filterCalls.push({ threshold: config.threshold });
        return (inputs[0] as number) >= (config.threshold as number);
      },
    };

    const graph = createGraph(
      withNodesConfig({
        nodesPlugins: [wsPlugin, filterPlugin],
        nodes: [
          { id: 'ws', type: 'ws', config: {} },
          {
            id: 'f',
            type: 'filter',
            config: { threshold: 50, isSubscribed: true },
            inputs: ['ws'],
          },
        ],
        subscriptions: {
          // Triggering feedback from a handler: adjust the filter as soon as it blocks.
          f: value => {
            if (value === false) {
              longRunning.requestConfigUpdate('f', { threshold: 5 }, { minIntervalMs: 20 });
            }
          },
        },
      })
    );
    const longRunning = graph.run();
    await delay(10);

    stream.next(10); // 10 < 50 -> blocked -> handler schedules a triggering update
    await delay(60);

    // The deferred update recomputed the filter on the replayed input with the new base.
    expect(filterCalls[filterCalls.length - 1]).toEqual({ threshold: 5 });
    expect(graph.exportState().nodes['f']?.config?.threshold).toBe(5);

    graph.destroy();
  });

  it('injects __requestConfigUpdate into controllers: a cadence loop retunes a live stream source', async () => {
    const registry = new NodeRegistry();
    // Poller-like source: config.intervalTag is captured when the Observable is
    // subscribed (like fetch's config.poll) — a control-slot can never reach it.
    const captured: unknown[] = [];
    const sources = new Map<string, Subject<unknown>>();
    registry.register({
      type: 'poller',
      category: 'data',
      compute: config => {
        captured.push(config.intervalTag);
        const s = new Subject<unknown>();
        sources.set(String(config.intervalTag), s);
        return s.asObservable();
      },
    });
    registry.register({
      type: 'governor',
      category: 'operational',
      compute: (config, inputs) => {
        // Quota-governor pattern: observed load too high -> slow the poller down
        // via the TRIGGERING path (subscribe-time field).
        if ((inputs[0] as number) > 100) {
          config.__requestConfigUpdate?.('p', { intervalTag: 'slow' });
        }
        return 'observed';
      },
    });

    const engine = new ReactiveGraphEngine(registry);
    engine.addNode({ id: 'p', type: 'poller', config: { intervalTag: 'fast' } });
    engine.addNode({ id: 'g', type: 'governor', inputs: ['p'], controls: [] });

    await delay(10);
    expect(captured).toEqual(['fast']); // source subscribed once with the base config

    sources.get('fast')?.next(500); // overload observed -> governor pushes
    await delay(30);

    // The triggering path re-created the source subscription with the new base:
    // compute ran again, the captured subscribe-time field changed.
    expect(captured).toEqual(['fast', 'slow']);
    expect(engine.exportState().nodes['p']?.config?.intervalTag).toBe('slow');

    engine.destroy();
  });

  it('__requestConfigUpdate enforces the 1000ms-per-target floor (plugin path coalesces bursts)', async () => {
    const { engine, src } = buildEngine();
    let updates = 0;
    engine.on(EngineEventType.NODE_UPDATED, () => {
      updates++;
    });

    // Grab the injected writer from a controller wrapper.
    engine.addNode({ id: 'c', type: 'filter', inputs: ['f'], controls: [] });
    const wrapper = (
      engine as unknown as { wrappers: Map<string, { config: NodeConfig }> }
    ).wrappers.get('c');
    const push = wrapper?.config.__requestConfigUpdate;
    expect(typeof push).toBe('function');

    src.next(60);
    await delay(10);
    const base = updates;

    push?.('f', { threshold: 1 }, { minIntervalMs: 0 }); // floor overrides 0
    await delay(30);
    expect(updates).toBe(base + 1); // first applies (no prior history)

    push?.('f', { threshold: 2 });
    push?.('f', { threshold: 3 });
    await delay(200); // well under the 1000ms floor
    expect(updates).toBe(base + 1); // burst coalesced, still pending

    engine.destroy(); // pending timer cancelled — no posthumous update
    await delay(100);
    expect(updates).toBe(base + 1);
  });

  it('strips __requestConfigUpdate on export and revokes it with its owner', async () => {
    const { engine, src } = buildEngine();
    let stash: NodeConfig['__requestConfigUpdate'];
    const registry2 = (engine as unknown as { registry: { register: (p: unknown) => void } })
      .registry;
    registry2.register({
      type: 'grabber',
      category: 'operational',
      compute: (config: NodeConfig) => {
        stash = config.__requestConfigUpdate;
        return 'ok';
      },
    });
    engine.addNode({ id: 'c', type: 'grabber', config: { gain: 1 }, inputs: ['f'], controls: [] });

    src.next(60);
    await delay(10);
    expect(typeof stash).toBe('function');
    expect(engine.exportState().nodes['c']?.config ?? {}).not.toHaveProperty(
      '__requestConfigUpdate'
    );

    engine.removeNode('c');
    let updates = 0;
    engine.on(EngineEventType.NODE_UPDATED, () => {
      updates++;
    });
    stash?.('f', { threshold: 9 });
    await delay(50);
    expect(updates).toBe(0); // revoked writer is inert

    engine.destroy();
  });

  it('Build API guards: not long-running and unknown node ids are rejected', () => {
    const wsPlugin: INodePlugin = { type: 'ws', category: 'data', compute: () => 1 };
    const graph = createGraph(
      withNodesConfig({ nodesPlugins: [wsPlugin], nodes: [{ id: 'ws', type: 'ws', config: {} }] })
    );

    const longRunning = graph.run();
    expect(() => longRunning.requestConfigUpdate('nope', { a: 1 })).toThrow(/not found/);
    graph.destroy();
  });
});
