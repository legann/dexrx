# DexRx API Reference

## Core API

### Creating Graphs
- `createGraph(...operators)` - Create graph using Build API operators

### Execution Modes

#### `execute()`
- `await graph.execute(options?)` - Single execution, returns after all computations complete
- **Results**: Via `exportState()` after completion
- **Options**: `{ timeout?, checkInterval?, onDone? }`

#### `run()`
- `const longRunning = graph.run({ initialState? })` - Start long-running graph
- **Returns**: `LongRunningGraph` interface
- **Results**: Via subscription handlers
- **Options**: `{ initialState? }` - Initial state to import before starting

---

## Build API Operators

### Graph Configuration
- `withOptions(options)` - Engine options, runtime context, execution context
- `withNodesConfig(config)` - Unified configuration (nodesPlugins + nodes + subscriptions)

### IoC Provider Operators
- `withCacheProvider(provider)` - Cache provider
- `withLoggerProvider(provider)` - Logger provider
- `withPersistence(provider)` - Persistence provider
- `withEventContextProvider(provider)` – Event context provider
- `withNotifications(provider)` – Notification provider

---

## Parallel Execution

### Configuration
- Configure via `withOptions()` with `executionContext` and `parallelOptions`
- **Execution Modes**: `SERIAL` (default, main thread) or `PARALLEL` (workers/threads)
- **Browser**: Web Workers (requires `workerScriptUrl`)
- **Node.js**: Worker Threads (requires `workerPath`)

### ParallelExecutionOptions
- `maxWorkers?` - Maximum number of workers (default: CPU cores - 1, min 2)
- `workerTimeout?` - Task timeout in milliseconds (default: 30000ms)
- `workerScriptUrl?` - Web Worker script URL (browser only, required for parallel mode)
- `workerPath?` - Node.js worker file path (Node.js only, required for parallel mode)
- `minComplexity?` - Minimum complexity threshold for parallel execution
- `logger?` - Optional logger for debugging

---

## ExecutableGraph Methods

### Lifecycle
- `execute(options?)` - Single execution
- `run({ initialState? })` - Start long-running graph, returns `LongRunningGraph`
- `destroy()` - Destroy graph and free resources

### State Management
- `exportState(includeMetadata?)` - Export graph state
- `importState(state, options?)` - Import state

### Observation
- `observeNode(nodeId)` - Get Observable for node
- `observeSubscribedNodes()` - Get Observables for all subscribed nodes
- `getStats()` - Execution statistics (includes nodesCount, activeSubscriptions, activeTasks, pendingHooks, errorCount, computeCount, memoryUsage, uptime, errorHistory, computeHistory, nodeTypeStats)
- `getState()` - Current engine state. Returns `EngineState` enum: `INITIALIZED`, `RUNNING`, `PAUSED`, `STOPPED`, `DESTROYED`. Can be used with engine hooks for lifecycle monitoring.
- `getActiveTasks()` - Active tasks count

### Engine Hooks
- `on(eventType, handler)` - Subscribe to engine event. Returns unsubscribe function.
  - **Node Events**: `NODE_ADDED`, `NODE_REMOVED`, `NODE_UPDATED`, `NODE_COMPUTE_ERROR`, `NODE_SKIP_COMPUTATION`
  - **Lifecycle Events**: `ENGINE_INITIALIZED`, `ENGINE_STARTED`, `ENGINE_PAUSED`, `ENGINE_RESUMED`, `ENGINE_STATE_CHANGED`, `BEFORE_DESTROY`, `AFTER_DESTROY`, `ENGINE_RESTORED`
  - **Monitoring Events**: `HEALTH_CHECK`, `ERROR_THRESHOLD_EXCEEDED`, `MEMORY_THRESHOLD_EXCEEDED`

---

## LongRunningGraph Methods

### Execution Control
- `pause()` - Pause execution
- `resume()` - Resume execution
- `stop()` - Stop execution

### Graph Updates
- `updateGraph(nodes, options?)` - Update graph structure (nodes added/removed, dependencies change). Recreates entire graph.
  - **Options**: `{ autoStart?, preserveSubscriptions? }`
- `updateNode(nodeId, nodeDef)` - Update single node's config/data without recreating graph. Preserves node's Subject and automatically triggers recalculation of dependent nodes.

---

## Provider Interfaces

### ICacheProvider
- `get(key)` - Get from cache
- `set(key, value, ttl?)` - Save to cache
- `delete(key)` - Delete from cache
- `clear()` - Clear cache
- `getStats()` - Cache statistics

### ILoggerProvider
- `log(level, message, ...args)` - Logging
- `getInputGuardReport()` - Input guard report
- `clearInputGuardLogs()` - Clear input guard logs

### IPersistenceProvider
- `saveState(key, state, options?)` - Save state
- `loadState(key)` - Load state
- `deleteState(key)` - Delete state

### INotificationProvider
- `notify(event, data)` - Send notification
- `broadcast(event, data)` - Broadcast notification
- `subscribe(event, handler)` - Subscribe to events
- `unsubscribe(event, handler)` - Unsubscribe from events

### IEventSourceProvider
- `parseEvent(event)` - Parse event
- `getContext()` - Get event context
