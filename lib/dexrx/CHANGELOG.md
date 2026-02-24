# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.1.0] - 2026-02-24

### Summary

Improvements to parallel execution (Node.js) and packaging: least-loaded worker selection, stable worker script path, and clearer documentation of parallel mode behaviour.

### Added

- **Worker script in package:** Packaged worker at `dist/worker.js`, copied during build (`yarn build:worker`). Export `./worker` in `package.json` — use `require.resolve('dexrx/worker')` to get the path.
- **`engines` in package.json:** `"node": ">=20.0.0"` to declare supported Node version for parallel mode.

### Changed

- **NodeWorkerContext (Node.js):** Worker selection is now **least-loaded** (task is sent to the worker with the fewest pending tasks) instead of random. `pendingTasksByWorker` is used for both tracking and selection.
- **Worker script resolution:** Lookup order is: packaged `dist/worker.js` (from `utils/execution/`), then `options.workerPath`, then test/dev paths, then inline fallback. Clearer error when no worker script is found.
- **README:** Short “Parallel Execution” section: limitation (custom plugins not in workers), path resolution, and load balancing (least-loaded in Node, round-robin in browser).

### Fixed

- Worker path for packaged script: resolved as `../../../dist/worker.js` so it works from both source and built `dist` (e.g. ts-jest and production).

---

## [2.0.0] - 2026-02-20

### Summary

Version 2.0.0 unifies the plugin contract and execution path: **plugins must return `Observable<T> | T`** instead of `Promise<T> | T`. The engine no longer treats plugin return values as Promises in its public contract. This allows a single, consistent model for both stateless (one value and done) and long-running (stream of values) nodes, with first-class cancellation via subscription teardown.

---

### Breaking changes

#### Plugin contract: `compute()` return type

- **Before (1.x):** `compute(config, inputs): Promise<T> | T` (and optionally `ICancelableComputation<T>`).
- **After (2.0):** `compute(config, inputs): Observable<T> | T`.

Plugins must not return a `Promise` from `compute()` in the typed contract. The engine normalizes results with `toObservable(result)` and subscribes once; cancellation is done via `unsubscribe()`, not Promise cancellation.

**Migration for plugin authors:**

- **Single async value (e.g. one HTTP request):**  
  Before: `return fetch(url).then(r => r.json())`.  
  After: `return from(fetch(url).then(r => r.json()))` or `return defer(() => fetch(url).then(r => r.json()))`.
- **Synchronous value:**  
  No change: `return value` is still valid; the engine wraps it with `of(value)`.
- **Stream of values (long-running, e.g. WebSocket or polling):**  
  Return an `Observable` that emits values and does not call `complete()` until the stream ends (if ever). The engine keeps the subscription; on teardown it unsubscribes.

#### Removed: Promise and ICancelableComputation from plugin API

- Support for plugins returning `Promise` has been **removed from the public plugin type** (`INodePlugin`, `IServerNodePlugin`). The engine still converts a Promise to an Observable internally in execution-context adapters (e.g. `MainThreadContext`), but the **documented and typed contract for plugins** is `Observable<T> | T` only.
- **`ICancelableComputation<T>`** and the **`enableCancelableCompute`** option have been removed. Cancellation is only via unsubscribing from the Observable returned by the plugin.

#### Removed: activePromiseTasks / activeComputations

- **`activePromiseTasks`** and **`activeComputations`** have been removed from the engine.
- **Replacement:** **`activeObservableNodes`** — a `Set<string>` of node IDs that have an active Observable subscription (no `complete()` yet). Stats (e.g. `getStats().activeTasks`) and stabilization logic use this set.

#### Behavior: single execution path

- All nodes (zero-input and with inputs) now go through: `toObservable(plugin.compute(...))` → `observable.subscribe({ next, error, complete })`. The engine no longer has a separate “Promise path” for plugin results; one path for both single-value and streaming results.

---

### Added

- **`toObservable(result)`** in the engine: normalizes `Observable`, `Promise`, or plain value to an `Observable`. Used internally; execution contexts may still receive Promises and convert them for the engine.
- **`activeObservableNodes`**: single source of truth for “active” node subscriptions; used for stabilization and skip-computation hooks.

---

### Changed

- **Stabilization:** Based on `activeObservableNodes` (and related logic) instead of `activePromiseTasks`. A node is considered active until its Observable subscription calls `complete()` or is unsubscribed.
- **Cleanup:** On node cleanup, the engine unsubscribes from the node’s Observable (`subscriptions.get(id)?.unsubscribe()`) and removes the node from `activeObservableNodes`.
- **Skip-computation hooks:** Emission of deferred `NODE_SKIP_COMPUTATION` hooks is tied to `complete` / `finalize` of the Observable subscription, not to Promise resolution.

---

### Migration checklist (for consumers of DexRx)

1. **Update all custom plugins:** Ensure `compute()` returns `Observable<T> | T` only. Replace `return somePromise` with `return from(somePromise)` or `return defer(() => somePromise)`.
2. **Remove use of `ICancelableComputation`** and **`enableCancelableCompute`** if you used them; rely on subscription teardown instead.
3. **If you relied on `activePromiseTasks` or internal stats:** Switch to the fact that “active” is now expressed via Observable subscriptions; public stats (e.g. `activeTasks`) still reflect active work.
4. **Tests:** Any tests that mock or assert on plugin return type must use Observables (or values), not Promises, for the plugin contract.

---

## [1.0.0] - 2025-11-04

### Added
- Initial release of DexRx reactive graph engine
- Core reactive graph engine with RxJS integration
- Support for parallel execution (Web Workers, Node.js Worker Threads)
- Node registry system for plugin management
- Caching system with LRU and TTL support
- Lifecycle hooks and event management
- Input validation and security guards
- Serialization/deserialization of graph state
- Environment adapters for cross-platform compatibility
- Comprehensive logging system
- TypeScript support with full type definitions

### Features
- Engine execution modes for execution control
- Cancelable computations with AbortSignal
- Memory leak detection and prevention
- Error handling and recovery mechanisms
- Performance optimizations and throttling

### Documentation
- Comprehensive README with API documentation
- Examples and usage patterns
- Architecture documentation

