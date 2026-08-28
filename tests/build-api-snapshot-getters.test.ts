import { createGraph } from '../lib/dexrx/src/graph';
import { withNodesConfig } from '../lib/dexrx/src/operators';
import { INodePlugin } from 'dexrx';

const sourcePlugin: INodePlugin = {
  type: 'source',
  category: 'data',
  compute(config: { value: unknown }) {
    return config.value;
  },
};

function makeGraph() {
  return createGraph(
    withNodesConfig({
      nodesPlugins: [sourcePlugin],
      nodes: [{ id: 'a', type: 'source', config: { value: 42 } }],
    })
  );
}

// G4: exportState()/getStats() on a not-yet-started graph used to spin up an engine,
// call engine.start() (leaving it RUNNING) but never set this.isRunning, so a later
// execute()/run() threw "Cannot start engine in state: running".
describe('ExecutableGraph snapshot getters before start (G4)', () => {
  it('getStats() before execute() does not break a later execute()', async () => {
    const graph = makeGraph();
    expect(() => graph.getStats()).not.toThrow();

    let error: unknown = null;
    try {
      await graph.execute();
    } catch (e) {
      error = e;
    }
    expect(error).toBeNull();
    graph.destroy();
  });

  it('exportState() before execute() does not break a later execute()', async () => {
    const graph = makeGraph();
    expect(() => graph.exportState()).not.toThrow();

    let error: unknown = null;
    try {
      await graph.execute();
    } catch (e) {
      error = e;
    }
    expect(error).toBeNull();
    graph.destroy();
  });

  it('repeated getStats() before execute() stays consistent and non-fatal', async () => {
    const graph = makeGraph();
    expect(() => {
      graph.getStats();
      graph.getStats();
      graph.exportState();
    }).not.toThrow();

    let error: unknown = null;
    try {
      await graph.execute();
    } catch (e) {
      error = e;
    }
    expect(error).toBeNull();
    graph.destroy();
  });
});
