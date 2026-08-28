import { createGraph } from '../lib/dexrx/src/graph';
import { withNodesConfig } from '../lib/dexrx/src/operators';
import { EngineState } from '../lib/dexrx/src/types/engine-state';
import { INodePlugin } from 'dexrx';

const sourcePlugin: INodePlugin = {
  type: 'source',
  category: 'data',
  compute(config: { value: unknown }) {
    return config.value;
  },
};

const delay = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

describe('ExecutableGraph.importState() into a running long-running graph', () => {
  // importState() on a RUNNING long-running graph pauses the current engine, but
  // importStateInternal() swaps in a fresh engine. The graph must start (not resume) that
  // fresh engine, otherwise it throws "Cannot resume engine in state: initialized" and is
  // left not running. run({ initialState }) routes through this same path.
  it('imports saved state into a live graph without throwing and stays RUNNING', async () => {
    const graphA = createGraph(
      withNodesConfig({
        nodesPlugins: [sourcePlugin],
        nodes: [{ id: 'a', type: 'source', config: { value: 30 } }],
      })
    );
    graphA.run();
    await delay(150);
    const state = graphA.exportState();
    expect(state.nodes['a'].currentValue).toBe(30);
    graphA.destroy();

    // graphB starts running with a DIFFERENT config (99), then imports the saved state.
    const graphB = createGraph(
      withNodesConfig({
        nodesPlugins: [sourcePlugin],
        nodes: [{ id: 'a', type: 'source', config: { value: 99 } }],
      })
    );
    graphB.run();
    await delay(150);
    expect(graphB.exportState().nodes['a'].currentValue).toBe(99);

    await graphB.importState(state);
    await delay(150);

    expect(graphB.getState()).toBe(EngineState.RUNNING);
    expect(graphB.exportState().nodes['a'].currentValue).toBe(30);
    graphB.destroy();
  });
});
