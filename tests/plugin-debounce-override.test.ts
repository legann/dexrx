import { Subject } from 'rxjs';
import { createGraph } from '../lib/dexrx/src/graph';
import { withNodesConfig, withOptions } from '../lib/dexrx/src/operators';
import { INodePlugin } from '../lib/dexrx/src/types/node-plugin';

// One macrotask drains the microtask-only tick chain (combineLatest + mergeMap(Promise.all)).
const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Per-plugin `debounceTime` override.
 *
 *   producer ─► consumer
 *
 * The engine-wide `debounceTime` is last-value-wins over its window: a rate limiter for
 * VALUE streams. When a producer emits asynchronously (`from(promise)`) and then a later
 * synchronous emission lands inside the same window, debounce keeps only the trailing one
 * and silently drops the async value. A plugin whose input is a stream of EVENTS — each
 * emission consumed once and not reconstructable from the next — declares `debounceTime = 0`
 * to opt out per type.
 *
 * The producer is modelled as a zero-input node; those bypass the debounce operator entirely
 * (engine, `inputStreams.length === 0` early return), so only the consumer's own debounce is
 * under test and the assertion is not coupled to a second window.
 */
describe('plugin-level debounceTime override', () => {
  const ENGINE_DEBOUNCE = 10;
  const ASYNC_TO_SYNC_MS = 3; // the async value lands inside the next sync emission's window

  interface Harness {
    producer: Subject<unknown>;
    plugins: INodePlugin[];
    seen: unknown[];
  }

  /** `consumerDebounce: undefined` inherits the engine value; `0` opts out. */
  function makeHarness(consumerDebounce: number | undefined): Harness {
    const producer = new Subject<unknown>();
    const seen: unknown[] = [];

    const producerPlugin: INodePlugin = {
      type: 'producer',
      category: 'data',
      compute: () => producer.asObservable(),
    };

    const consumerPlugin: INodePlugin = {
      type: 'consumer',
      category: 'operational',
      ...(consumerDebounce === undefined ? {} : { debounceTime: consumerDebounce }),
      compute: (_config, inputs) => {
        seen.push(inputs[0]);
        return inputs[0];
      },
    };

    return { producer, seen, plugins: [producerPlugin, consumerPlugin] };
  }

  function run(h: Harness) {
    return createGraph(
      withOptions({ engine: { debounceTime: ENGINE_DEBOUNCE, distinctValues: false } }),
      withNodesConfig({
        nodesPlugins: h.plugins,
        nodes: [
          { id: 'producer', type: 'producer', config: {} },
          { id: 'consumer', type: 'consumer', inputs: ['producer'], config: {} },
        ],
      })
    ).run();
  }

  /** An async emission, then the next synchronous emission inside the same window. */
  async function driveAsyncThenSync(h: Harness): Promise<void> {
    h.producer.next({ tag: 'warmup' }); // leave INIT so skipWhile opens the pipeline
    await wait(ENGINE_DEBOUNCE * 4);
    h.seen.length = 0;

    await Promise.resolve().then(() => h.producer.next({ tag: 'async' }));
    await wait(ASYNC_TO_SYNC_MS);
    h.producer.next({ tag: 'sync' });
    await wait(ENGINE_DEBOUNCE * 5);
  }

  const tags = (seen: unknown[]) => seen.map(v => (v as { tag?: string })?.tag);

  it('delivers the async emission to a plugin that opts out (debounceTime = 0)', async () => {
    const h = makeHarness(0);
    const graph = run(h);
    await driveAsyncThenSync(h);

    expect(tags(h.seen)).toEqual(['async', 'sync']);
    graph.destroy();
  });

  it('drops the async emission when the plugin inherits the engine-wide debounce', async () => {
    // Pins the behaviour the override exists to change: without the opt-out only the
    // trailing synchronous emission survives the window.
    const h = makeHarness(undefined);
    const graph = run(h);
    await driveAsyncThenSync(h);

    expect(tags(h.seen)).toEqual(['sync']);
    graph.destroy();
  });

  it('honours a plugin value larger than the engine-wide one', async () => {
    const h = makeHarness(ENGINE_DEBOUNCE * 6);
    const graph = run(h);

    h.producer.next({ tag: 'warmup' });
    await wait(ENGINE_DEBOUNCE * 10);
    h.seen.length = 0;

    h.producer.next({ tag: 'async' });
    await wait(ENGINE_DEBOUNCE * 2); // shorter than the plugin window, longer than the engine one
    h.producer.next({ tag: 'sync' });
    await wait(ENGINE_DEBOUNCE * 12);

    expect(tags(h.seen)).toEqual(['sync']);
    graph.destroy();
  });

  it('survives a pause/resume cycle (recreateNodeSubscription rebuilds the pipeline)', async () => {
    // Guards the third pipeline site: resume() -> resumeAllSubscriptions() ->
    // recreateNodeSubscriptions() -> recreateNodeSubscription. Fixing only addNode and
    // updateNode would let the global debounce silently return after any resume.
    const h = makeHarness(0);
    const graph = run(h);
    await driveAsyncThenSync(h);
    expect(tags(h.seen)).toContain('async');

    graph.pause();
    graph.resume();
    await flush();
    await wait(ENGINE_DEBOUNCE * 4);

    h.seen.length = 0;
    await Promise.resolve().then(() => h.producer.next({ tag: 'async' }));
    await wait(ASYNC_TO_SYNC_MS);
    h.producer.next({ tag: 'sync' });
    await wait(ENGINE_DEBOUNCE * 5);

    expect(tags(h.seen)).toContain('async');
    graph.destroy();
  });
});
