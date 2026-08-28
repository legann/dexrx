/**
 * Worker-pool resilience unit tests (audit batch 3: W2 / W9).
 * These exercise the private pool-maintenance methods directly (no task execution),
 * so they are deterministic and do not depend on worker timing.
 */

import { NodeWorkerContext } from '../lib/dexrx/src/utils/execution/node-worker-context';
import * as path from 'path';

const WORKER_PATH = path.resolve(process.cwd(), 'tests/workers/node-worker-script.js');

function priv<T = unknown>(ctx: NodeWorkerContext, field: string): T {
  return (ctx as unknown as Record<string, T>)[field];
}

function createCtx(maxWorkers = 3): NodeWorkerContext {
  return new NodeWorkerContext({
    maxWorkers,
    workerPath: WORKER_PATH,
    disableAutoCleanup: true,
    workerTimeout: 5000,
  });
}

describe('NodeWorkerContext — pool resilience (W2 / W9)', () => {
  jest.setTimeout(15000);

  it('reindexAfterRemoval preserves survivors task sets and shifts indices (W9)', () => {
    const ctx = createCtx(3);
    const byWorker: Map<number, Set<string>> = priv(ctx, 'pendingTasksByWorker');
    byWorker.get(0)!.add('a');
    byWorker.get(1)!.add('b');
    byWorker.get(2)!.add('c1');
    byWorker.get(2)!.add('c2');

    // Remove the worker at index 1.
    (ctx as unknown as { reindexAfterRemoval(i: number): void }).reindexAfterRemoval(1);

    // Old index 0 stays; old index 2 shifts down to 1; old index 1 is dropped.
    expect([...byWorker.keys()].sort((x, y) => x - y)).toEqual([0, 1]);
    expect([...byWorker.get(0)!]).toEqual(['a']); // untouched, NOT reset to empty
    expect([...byWorker.get(1)!].sort()).toEqual(['c1', 'c2']); // preserved from old index 2

    ctx.terminate();
  });

  it('removeWorker rejects only the crashed worker tasks and preserves the rest (W2)', () => {
    const ctx = createCtx(3);
    const workers: unknown[] = priv(ctx, 'workers');
    const pendingTasks: Map<
      string,
      { resolve: (v: unknown) => void; reject: (e?: unknown) => void }
    > = priv(ctx, 'pendingTasks');
    const byWorker: Map<number, Set<string>> = priv(ctx, 'pendingTasksByWorker');

    const outcome: Record<string, 'resolved' | 'rejected'> = {};
    ['t0', 't1', 't2'].forEach((id, i) => {
      pendingTasks.set(id, {
        resolve: () => {
          outcome[id] = 'resolved';
        },
        reject: () => {
          outcome[id] = 'rejected';
        },
      });
      byWorker.get(i)!.add(id);
    });

    // Crash the worker at index 1.
    (
      ctx as unknown as { removeWorker(w: unknown, reason: string, err?: unknown): void }
    ).removeWorker(workers[1], 'crashed', new Error('boom'));

    // Only worker 1's task is rejected; the others remain untouched and still pending.
    expect(outcome['t1']).toBe('rejected');
    expect(outcome['t0']).toBeUndefined();
    expect(outcome['t2']).toBeUndefined();
    expect(pendingTasks.has('t1')).toBe(false);
    expect(pendingTasks.has('t0')).toBe(true);
    expect(pendingTasks.has('t2')).toBe(true);

    ctx.terminate();
  });
});
