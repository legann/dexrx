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

describe('withNodesConfig function subscription — handler dispatch', () => {
  // The function-form subscription is dispatched by shape: a generator declares one
  // parameter, so any arity >= 2 is a handler. A 2-parameter handler (Function.length === 2)
  // must be registered, not routed to the generator branch and silently dropped.
  it('registers a 2-parameter (nodeId, value) handler', async () => {
    const received: Array<{ nodeId: string; value: unknown }> = [];
    const graph = createGraph(
      withNodesConfig({
        nodesPlugins: [sourcePlugin],
        nodes: [{ id: 'a', type: 'source', config: { value: 42, isSubscribed: true } }],
        subscriptions: (nodeId: string, value: unknown) => {
          received.push({ nodeId, value });
        },
      })
    );
    await graph.execute();
    expect(received.length).toBeGreaterThan(0);
    expect(received.some(r => r.value === 42)).toBe(true);
    graph.destroy();
  });
});
