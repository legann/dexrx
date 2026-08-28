import { Subject } from 'rxjs';
import { createGraph } from '../lib/dexrx/src/graph';
import { withNodesConfig } from '../lib/dexrx/src/operators';
import { INodePlugin } from '../lib/dexrx/src/types/node-plugin';
import { NodeConfig } from '../lib/dexrx/src/types/utils';

// One macrotask drains the microtask-only tick chain (combineLatest + mergeMap(Promise.all)).
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

/**
 * End-to-end control loop over the Build API (phase 2):
 *
 *   wsA ─► filterA ─┐
 *                   ├─► controller ─(__targets)─► control-slots of filterA / filterB
 *   wsB ─► filterB ─┘
 *
 * Two sources live in different value bands; both filters start with thresholds
 * that pass everything. One hysteresis controller observes both pass-streams and
 * pushes ADDRESSED per-filter threshold deltas until each filter's pass-rate
 * converges to the setpoint. Deterministic inputs, no timers, no randomness.
 */
describe('feedback control loop e2e (Build API, dual source, addressed)', () => {
  const SETPOINT = 0.5;
  // The controller computes on EVERY input emission (combineLatest), so each EMA gets
  // updated TWICE per tick-pair with the same pass/block sample. At a converged
  // threshold the alternating samples then ripple the EMA by ±(1−(1−α)²)/(2−(1−α)²)
  // ≈ ±0.11 at α 0.2 — the deadband must sit ABOVE that ripple with margin, or the
  // controller keeps pushing forever (never holds).
  const ALPHA = 0.2;
  const DEADBAND = 0.16; // hysteresis: no push while |err| <= deadband (self-damping)
  const GAIN = 10; // modest gain: band width is 20, larger steps overshoot past the band

  function makePlugins() {
    const streams: Record<string, Subject<unknown>> = {
      a: new Subject<unknown>(),
      b: new Subject<unknown>(),
    };
    const filterCalls: Array<{ tag: unknown; threshold: unknown }> = [];
    let pushes = 0;

    const wsPlugin: INodePlugin = {
      type: 'ws',
      category: 'data',
      compute: config => streams[config.channel as string].asObservable(),
    };

    const adaptiveFilterPlugin: INodePlugin = {
      type: 'adaptive_filter',
      category: 'operational',
      compute: (config, inputs) => {
        filterCalls.push({ tag: config.tag, threshold: config.threshold });
        const value = inputs[0] as number;
        return { tag: config.tag, passed: value >= (config.threshold as number) };
      },
    };

    // Stateful instance (SERIAL): per-input EMA of pass-rate + hysteresis deadband.
    const ema: Record<string, number> = { fa: 0.5, fb: 0.5 };
    const thr: Record<string, number> = {};
    const hysteresisControllerPlugin: INodePlugin = {
      type: 'hysteresis_controller',
      category: 'operational',
      compute: (config, inputs) => {
        const targets: Record<string, NodeConfig> = {};
        for (const input of inputs as Array<{ tag: string; passed: boolean }>) {
          const key = input.tag;
          ema[key] = ALPHA * (input.passed ? 1 : 0) + (1 - ALPHA) * ema[key];
          const err = ema[key] - SETPOINT;
          if (Math.abs(err) <= DEADBAND) continue; // hysteresis: hold inside the deadband
          const targetId = key === 'fa' ? 'filterA' : 'filterB';
          thr[key] = (thr[key] ?? (config[`base_${key}`] as number)) + GAIN * err;
          targets[targetId] = { threshold: thr[key] };
        }
        // Nothing to adjust -> non-object payload, ignored by the router (no push).
        if (Object.keys(targets).length === 0) return 'hold';
        pushes++;
        return { __targets: targets };
      },
    };

    return { streams, filterCalls, wsPlugin, adaptiveFilterPlugin, hysteresisControllerPlugin, pushCount: () => pushes };
  }

  function buildGraph(p: ReturnType<typeof makePlugins>) {
    return createGraph(
      withNodesConfig({
        nodesPlugins: [p.wsPlugin, p.adaptiveFilterPlugin, p.hysteresisControllerPlugin],
        nodes: [
          { id: 'wsA', type: 'ws', config: { channel: 'a' } },
          { id: 'wsB', type: 'ws', config: { channel: 'b' } },
          // Both start passing everything (threshold 0): pass-rate 1.0, far from setpoint.
          { id: 'filterA', type: 'adaptive_filter', config: { tag: 'fa', threshold: 0 }, inputs: ['wsA'] },
          { id: 'filterB', type: 'adaptive_filter', config: { tag: 'fb', threshold: 0 }, inputs: ['wsB'] },
          {
            id: 'controller',
            type: 'hysteresis_controller',
            config: { base_fa: 0, base_fb: 0 },
            inputs: ['filterA', 'filterB'],
            controls: ['filterA', 'filterB'],
          },
        ],
      })
    );
  }

  it('converges both filters to the setpoint with per-target thresholds, without config churn', async () => {
    const p = makePlugins();
    const graph = buildGraph(p);
    graph.run();
    await flush();

    const statsBefore = graph.getStats();

    // Deterministic streams in different bands: A alternates 20/40, B alternates 60/80.
    // A threshold inside (20,40) yields pass-rate 0.5 for A; inside (60,80) for B.
    const lastThreshold: Record<string, number> = { fa: NaN, fb: NaN };
    const TICKS = 120;
    let pushesAtTwoThirds = 0;
    for (let i = 0; i < TICKS; i++) {
      p.streams.a.next(i % 2 === 0 ? 20 : 40);
      p.streams.b.next(i % 2 === 0 ? 60 : 80);
      await flush();
      if (i === Math.floor((TICKS * 2) / 3)) pushesAtTwoThirds = p.pushCount();
    }

    for (const call of p.filterCalls) {
      lastThreshold[call.tag as string] = call.threshold as number;
    }

    // Addressed convergence: each filter got its OWN threshold inside its band.
    expect(lastThreshold.fa).toBeGreaterThan(20);
    expect(lastThreshold.fa).toBeLessThan(40);
    expect(lastThreshold.fb).toBeGreaterThan(60);
    expect(lastThreshold.fb).toBeLessThan(80);

    // Hysteresis: once inside the deadband the controller stops pushing (self-damping).
    // The honest bound is a PLATEAU: zero pushes over the final third of the run.
    expect(p.pushCount()).toBeGreaterThan(0);
    expect(p.pushCount()).toBe(pushesAtTwoThirds);

    // Override, not mutate: base configs stay clean after the whole run.
    const state = graph.exportState();
    expect(state.nodes['filterA']?.config?.threshold).toBe(0);
    expect(state.nodes['filterB']?.config?.threshold).toBe(0);
    // controls survives the Build API -> engine conversion and the export.
    expect(state.nodes['controller']?.controls).toEqual(['filterA', 'filterB']);

    // No churn: the loop ran entirely through control-slots — no node was re-created,
    // so the engine holds the same number of active subscriptions as at start.
    const statsAfter = graph.getStats();
    expect(statsAfter.activeSubscriptions).toBe(statsBefore.activeSubscriptions);

    graph.destroy();
  });

  it('keeps the loop alive across updateGraph() (controls survive the rebuild)', async () => {
    const p = makePlugins();
    const graph = buildGraph(p);
    const longRunning = graph.run();
    await flush();

    // Feed BOTH sources: the controller's combineLatest waits for every input.
    p.streams.a.next(30);
    p.streams.b.next(70);
    await flush();

    // Rebuild with the same topology (the documented way to restructure a live graph).
    longRunning.updateGraph(
      [
        { id: 'wsA', type: 'ws', config: { channel: 'a' } },
        { id: 'wsB', type: 'ws', config: { channel: 'b' } },
        { id: 'filterA', type: 'adaptive_filter', config: { tag: 'fa', threshold: 0 }, inputs: ['wsA'] },
        { id: 'filterB', type: 'adaptive_filter', config: { tag: 'fb', threshold: 0 }, inputs: ['wsB'] },
        {
          id: 'controller',
          type: 'hysteresis_controller',
          config: { base_fa: 0, base_fb: 0 },
          inputs: ['filterA', 'filterB'],
          controls: ['filterA', 'filterB'],
        },
      ],
      { autoStart: true }
    );
    await flush();

    // controls survived the rebuild: the exported engine def still declares them.
    expect(graph.exportState().nodes['controller']?.controls).toEqual(['filterA', 'filterB']);

    // And routing is functional: pushes keep landing after the rebuild
    // (several ticks: the deadband needs the EMA to drift past it).
    const before = p.pushCount();
    for (let i = 0; i < 4; i++) {
      p.streams.a.next(30);
      p.streams.b.next(70);
      await flush();
    }
    expect(p.pushCount()).toBeGreaterThan(before);

    graph.destroy();
  });

  it('updateGraph rejects a controls target missing from the new node set', async () => {
    const p = makePlugins();
    const graph = buildGraph(p);
    const longRunning = graph.run();
    await flush();

    expect(() =>
      longRunning.updateGraph([
        { id: 'wsA', type: 'ws', config: { channel: 'a' } },
        {
          id: 'controller',
          type: 'hysteresis_controller',
          config: {},
          inputs: ['wsA'],
          controls: ['filterGone'],
        },
      ])
    ).toThrow(/Control target 'filterGone' not found/);

    graph.destroy();
  });

  it('graph.updateNode() keeps the controller role when controls is omitted; controls:[] clears it', async () => {
    const p = makePlugins();
    const graph = buildGraph(p);
    const longRunning = graph.run();
    await flush();

    // Routine config push into the controller (the documented webhook pattern) —
    // controls omitted must KEEP the role, not silently kill the loop.
    longRunning.updateNode('controller', {
      id: 'controller',
      type: 'hysteresis_controller',
      config: { base_fa: 0, base_fb: 0, gain: 2 },
      inputs: ['filterA', 'filterB'],
    });
    await flush();
    expect(graph.exportState().nodes['controller']?.controls).toEqual(['filterA', 'filterB']);

    const before = p.pushCount();
    for (let i = 0; i < 4; i++) {
      p.streams.a.next(30);
      p.streams.b.next(70);
      await flush();
    }
    expect(p.pushCount()).toBeGreaterThan(before);

    // Explicit controls: [] deliberately clears the role.
    longRunning.updateNode('controller', {
      id: 'controller',
      type: 'hysteresis_controller',
      config: { base_fa: 0, base_fb: 0 },
      inputs: ['filterA', 'filterB'],
      controls: [],
    });
    await flush();
    expect(graph.exportState().nodes['controller']?.controls ?? []).toEqual([]);

    graph.destroy();
  });

  it('ExecutableGraph.fromState() restores controls (restart from snapshot keeps the loop)', async () => {
    const p = makePlugins();
    const graph = buildGraph(p);
    graph.run();
    await flush();
    p.streams.a.next(30);
    await flush();
    const snapshot = graph.exportState();
    graph.destroy();

    // fromState builds a fresh graph from the snapshot; register plugins via a fresh set.
    const p2 = makePlugins();
    const { ExecutableGraph } = await import('../lib/dexrx/src/graph/graph');
    const restored = ExecutableGraph.fromState(snapshot);
    // The restored Build API model carries controls — the engine built from it routes.
    const model = (restored as unknown as { graph: { nodes: Map<string, { controls?: readonly string[] }> } }).graph;
    expect(model.nodes.get('controller')?.controls).toEqual(['filterA', 'filterB']);
    void p2;
    restored.destroy();
  });

  it('supports controls across multiple withNodes operator calls (forward and backward references)', async () => {
    const p = makePlugins();
    // Controller declared in the FIRST operator call, its targets in the SECOND:
    // validation runs over the completed composition, so this must build fine.
    const graph = createGraph(
      withNodesConfig({
        nodesPlugins: [p.wsPlugin, p.adaptiveFilterPlugin, p.hysteresisControllerPlugin],
        nodes: [{ id: 'wsA', type: 'ws', config: { channel: 'a' } }],
      }),
      withNodesConfig({
        nodesPlugins: [p.adaptiveFilterPlugin, p.hysteresisControllerPlugin],
        nodes: [
          { id: 'filterA', type: 'adaptive_filter', config: { tag: 'fa', threshold: 0 }, inputs: ['wsA'] },
          {
            id: 'controller',
            type: 'hysteresis_controller',
            config: { base_fa: 0 },
            inputs: ['filterA'],
            controls: ['filterA'],
          },
        ],
      })
    );
    graph.run();
    await flush();

    for (let i = 0; i < 4; i++) {
      p.streams.a.next(30);
      await flush();
    }
    expect(p.pushCount()).toBeGreaterThan(0);

    graph.destroy();
  });

  it('rejects a controls target that does not exist in the built graph (static typo guard)', () => {
    const p = makePlugins();
    expect(() =>
      createGraph(
        withNodesConfig({
          nodesPlugins: [p.wsPlugin, p.adaptiveFilterPlugin, p.hysteresisControllerPlugin],
          nodes: [
            { id: 'wsA', type: 'ws', config: { channel: 'a' } },
            { id: 'filterA', type: 'adaptive_filter', config: { tag: 'fa', threshold: 0 }, inputs: ['wsA'] },
            {
              id: 'controller',
              type: 'hysteresis_controller',
              config: {},
              inputs: ['filterA'],
              controls: ['filterTypo'],
            },
          ],
        })
      )
    ).toThrow(/Control target 'filterTypo' not found/);
  });
});
