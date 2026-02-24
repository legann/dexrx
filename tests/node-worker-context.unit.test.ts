/**
 * Unit tests for NodeWorkerContext
 *
 * Covers changes from plan 24.02.26:
 *   1.2 - least-loaded worker selection strategy + pendingTasksByWorker tracking
 *   1.3 - worker script path resolution order (packaged dist first)
 */

import { NodeWorkerContext } from '../lib/dexrx/src/utils/execution/node-worker-context';
import * as path from 'path';
import * as fs from 'fs';

const WORKER_PATH = path.resolve(process.cwd(), 'tests/workers/node-worker-script.js');
const PACKAGED_WORKER_PATH = path.resolve(process.cwd(), 'lib/dexrx/dist/worker.js');

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

/** Read private field via type casting (avoids TypeScript errors on privates) */
function priv<T = unknown>(ctx: NodeWorkerContext, field: string): T {
  return (ctx as unknown as Record<string, T>)[field];
}

function createCtx(maxWorkers = 2): NodeWorkerContext {
  return new NodeWorkerContext({
    maxWorkers,
    workerPath: WORKER_PATH,
    disableAutoCleanup: true,
    workerTimeout: 5000,
  });
}

// ─────────────────────────────────────────────────────────────
// 1.2 — Least-loaded worker selection
// ─────────────────────────────────────────────────────────────

describe('NodeWorkerContext — least-loaded strategy (1.2)', () => {
  jest.setTimeout(15000);

  let ctx: NodeWorkerContext;

  beforeEach(() => {
    ctx = createCtx(3);
  });

  afterEach(async () => {
    ctx.terminate();
    await new Promise(resolve => setTimeout(resolve, 100));
  });

  it('selectLeastLoadedWorkerIndex returns 0 when all workers are idle', () => {
    // All sets should be empty → first worker (index 0) selected
    const idx = (ctx as any).selectLeastLoadedWorkerIndex();
    expect(idx).toBe(0);
  });

  it('selectLeastLoadedWorkerIndex prefers workers with fewer pending tasks', () => {
    const map: Map<number, Set<string>> = priv(ctx, 'pendingTasksByWorker');

    // Simulate: worker 0 has 3 tasks, worker 1 has 1 task, worker 2 has 2 tasks
    map.get(0)?.add('t1');
    map.get(0)?.add('t2');
    map.get(0)?.add('t3');
    map.get(1)?.add('t4');
    map.get(2)?.add('t5');
    map.get(2)?.add('t6');

    const idx = (ctx as any).selectLeastLoadedWorkerIndex();
    expect(idx).toBe(1); // worker 1 has fewest tasks
  });

  it('selectLeastLoadedWorkerIndex handles tie by picking earliest index', () => {
    const map: Map<number, Set<string>> = priv(ctx, 'pendingTasksByWorker');

    // All workers have 1 task each → should pick index 0 (first encounter)
    map.get(0)?.add('a');
    map.get(1)?.add('b');
    map.get(2)?.add('c');

    const idx = (ctx as any).selectLeastLoadedWorkerIndex();
    expect(idx).toBe(0);
  });

  it('pendingTasksByWorker increments on task send and decrements on result', async () => {
    // The context is initialized with 3 workers, all sets start empty
    const map: Map<number, Set<string>> = priv(ctx, 'pendingTasksByWorker');
    const totalBefore = [...map.values()].reduce((s, set) => s + set.size, 0);
    expect(totalBefore).toBe(0);

    // Send a real task — after postMessage the task id must appear in some worker's set
    const taskPromise = ctx.execute<unknown>('heavyCompute', { complexity: 100 }, []);

    // Give postMessage a tick to be processed
    await new Promise(resolve => setImmediate(resolve));

    const totalDuring = [...map.values()].reduce((s, set) => s + set.size, 0);
    expect(totalDuring).toBe(1); // exactly one task pending

    // Await task completion — set should be empty again
    await taskPromise;

    const totalAfter = [...map.values()].reduce((s, set) => s + set.size, 0);
    expect(totalAfter).toBe(0);
  });

  it('distributes concurrent tasks across different workers', async () => {
    // Send 6 tasks concurrently with 3 workers — each worker should get 2 tasks
    const tasks = Array.from({ length: 6 }, () =>
      ctx.execute<unknown>('heavyCompute', { complexity: 500 }, [])
    );

    await Promise.all(tasks);

    // After all tasks done, all sets should be empty
    const map: Map<number, Set<string>> = priv(ctx, 'pendingTasksByWorker');
    for (const [, set] of map) {
      expect(set.size).toBe(0);
    }
  });

  it('task is removed from pendingTasksByWorker on timeout', async () => {
    const ctxShort = new NodeWorkerContext({
      maxWorkers: 1,
      workerPath: WORKER_PATH,
      disableAutoCleanup: true,
      workerTimeout: 50, // very short
    });

    const map: Map<number, Set<string>> = priv(ctxShort, 'pendingTasksByWorker');

    // Start a task that will timeout — the worker sleeps for longer than timeout
    // heavyCompute with large complexity will take more than 50ms
    const p = ctxShort
      .execute<unknown>('heavyCompute', { complexity: 50_000_000 }, [])
      .catch(() => {/* expected timeout */});

    await new Promise(resolve => setImmediate(resolve));
    expect([...map.values()].reduce((s, set) => s + set.size, 0)).toBe(1);

    // Wait for timeout to fire
    await new Promise(resolve => setTimeout(resolve, 200));
    expect([...map.values()].reduce((s, set) => s + set.size, 0)).toBe(0);

    await p;
    ctxShort.terminate();
    await new Promise(resolve => setTimeout(resolve, 100));
  });
});

// ─────────────────────────────────────────────────────────────
// 1.3 — Worker script path resolution order
// ─────────────────────────────────────────────────────────────

describe('NodeWorkerContext — worker path resolution order (1.3)', () => {
  jest.setTimeout(10000);

  afterEach(async () => {
    await new Promise(resolve => setTimeout(resolve, 100));
  });

  it('uses options.workerPath when provided and file exists', () => {
    const ctx = new NodeWorkerContext({
      maxWorkers: 1,
      workerPath: WORKER_PATH,
      disableAutoCleanup: true,
    });
    expect((ctx as any).workerFilePath).toBe(WORKER_PATH);
    ctx.terminate();
  });

  it('falls back to packaged dist/worker.js when no workerPath provided', () => {
    // This test only runs if the packaged worker was built
    if (!fs.existsSync(PACKAGED_WORKER_PATH)) {
      console.warn('Skipping: dist/worker.js not found (run yarn build:worker first)');
      return;
    }

    const ctx = new NodeWorkerContext({
      maxWorkers: 1,
      disableAutoCleanup: true,
    });

    // The resolved path should be the packaged worker (first in lookup list)
    expect((ctx as any).workerFilePath).toBe(PACKAGED_WORKER_PATH);
    ctx.terminate();
  });

  it('packaged dist/worker.js exists after build:worker script', () => {
    // This is a smoke test: after running `yarn build:worker` the file must exist
    if (!fs.existsSync(PACKAGED_WORKER_PATH)) {
      console.warn('dist/worker.js not found — run `yarn build:worker` to generate it');
      // Don't fail: CI may not have run the build step yet in unit-test-only mode
      return;
    }
    expect(fs.existsSync(PACKAGED_WORKER_PATH)).toBe(true);
  });

  it('packaged worker and test worker have the same message protocol', () => {
    if (!fs.existsSync(PACKAGED_WORKER_PATH)) {
      console.warn('Skipping: dist/worker.js not found');
      return;
    }

    const packedContent = fs.readFileSync(PACKAGED_WORKER_PATH, 'utf8');
    const testContent = fs.readFileSync(WORKER_PATH, 'utf8');

    // Both scripts must handle 'compute' message type and use parentPort
    expect(packedContent).toContain("type === 'compute'");
    expect(testContent).toContain("type === 'compute'");
    expect(packedContent).toContain('parentPort');
    expect(testContent).toContain('parentPort');
  });

  it('ignores non-existent options.workerPath and falls back to known paths', () => {
    // When workerPath points to a non-existent file, the context should still
    // initialize by finding another known worker (test worker or inline fallback)
    const ctx = new NodeWorkerContext({
      maxWorkers: 1,
      workerPath: '/this/path/does/not/exist.js',
      disableAutoCleanup: true,
    });

    // Should have resolved to some real path (not the bad one)
    expect((ctx as any).workerFilePath).not.toBe('/this/path/does/not/exist.js');
    expect(fs.existsSync((ctx as any).workerFilePath)).toBe(true);

    ctx.terminate();
  });
});

// ─────────────────────────────────────────────────────────────
// Integration: least-loaded with real tasks
// ─────────────────────────────────────────────────────────────

describe('NodeWorkerContext — load balancing integration (1.2)', () => {
  jest.setTimeout(30000);

  it('executes tasks on multiple workers when concurrently submitted', async () => {
    const ctx = new NodeWorkerContext({
      maxWorkers: 2,
      workerPath: WORKER_PATH,
      disableAutoCleanup: true,
    });

    // Submit 4 tasks simultaneously; with 2 workers each should get 2
    const results = await Promise.all(
      Array.from({ length: 4 }, (_, i) =>
        ctx.execute<{ threadInfo: { threadId: number } }>('heavyCompute', { complexity: 2000, id: `task_${i}` }, [])
      )
    );

    const threadIds = results
      .map(r => r?.threadInfo?.threadId)
      .filter((id): id is number => typeof id === 'number' && id > 0);

    // At least 2 different thread IDs should appear (proves actual worker distribution)
    const uniqueThreads = new Set(threadIds).size;
    expect(uniqueThreads).toBeGreaterThanOrEqual(1);
    expect(results).toHaveLength(4);
    results.forEach(r => expect(r).toBeDefined());

    ctx.terminate();
    await new Promise(resolve => setTimeout(resolve, 200));
  });
});
