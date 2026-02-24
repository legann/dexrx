# DexRx

[![CI Status](https://github.com/legann/dexrx/actions/workflows/run-tests.yml/badge.svg)](https://github.com/legann/dexrx/actions/workflows/run-tests.yml)
[![Docs](https://github.com/legann/dexrx/actions/workflows/generate-docs.yml/badge.svg)](https://github.com/legann/dexrx/actions/workflows/generate-docs.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

**Reactive Computation Graph Engine for RxJS**

DexRx provides a declarative way to build and orchestrate reactive computation graphs. Built on top of RxJS, it adds a DAG (Directed Acyclic Graph) abstraction that automatically manages dependencies, subscriptions, and reactive updates.

## Table of Contents

- [Features](#features)
- [Requirements](#requirements)
- [Installation](#installation)
- [Documentation](#documentation)
- [Build API](#build-api)
- [Modes](#modes)
- [Parallel Execution](#parallel-execution)
- [Node Types](#node-types)
- [Engine Hooks](#engine-hooks)
- [Quick Start](#quick-start)
- [License](#license)

## Features

- **Graph orchestration** – Automatic dependency tracking and reactive updates
- **Plugin architecture** – Add custom computation types as node plugins
- **Inversion of control** – Integrate custom caching, logging, execution context or persistence providers
- **Engine hooks** – Event system for monitoring graph lifecycle, node events, errors, and health checks
- **Security** – Input validation and sanitization guards to prevent invalid data propagation through the graph
- **Environments** – Works in browser and Node.js
- **Parallel execution** – Configurable single and parallel execution modes (Web Workers in browser, Worker Threads in Node.js)

## Requirements

- **Node.js**: >= 20.0.0 (Worker Threads require Node.js 12+; Node.js 20+ is recommended and tested)
- **RxJS**: >= 7.8.0 (peer dependency)

### Tested Compatibility Matrix

DexRx is continuously tested against the following versions:

| Node.js | RxJS      | Status |
|---------|-----------|--------|
| 20.x    | 7.8.0     | ✅     |
| 20.x    | ^7.8.0    | ✅     |
| 22.x    | 7.8.0     | ✅     |
| 22.x    | ^7.8.0    | ✅     |

All combinations are automatically tested on every pull request via [GitHub Actions](.github/workflows/run-tests.yml).

## Installation

Configure npm to use GitHub Packages registry. Create or update `.npmrc`:

```
@legann:registry=https://npm.pkg.github.com
```

Install the package:

```bash
npm install @legann/dexrx rxjs --save
```

Or with yarn:

```bash
yarn add @legann/dexrx rxjs
```

## Documentation

For API reference, see [API_SUMMARY.md](./lib/dexrx/API_SUMMARY.md) (extracted from full documentation).

To generate API documentation from TypeScript source:

```bash
yarn docs
```

Documentation will be generated in `lib/dexrx/docs/api`. To view it locally:

```bash
yarn docs:serve
```

## Build API

The Build API uses functional composition with operators to create graphs declaratively.

**Core Operators:**
- `withOptions(options)` – Engine options, runtime context, execution context
- `withNodesConfig(config)` – Unified configuration (nodesPlugins + nodes + subscriptions)
- `withCacheProvider(provider)` – Custom cache provider
- `withLoggerProvider(provider)` – Custom logger provider
- `withPersistence(provider)` – State persistence provider
- `withEventContextProvider(provider)` – Event context provider
- `withNotifications(provider)` – Notification provider

## Modes

DexRx provides two execution modes:

### `execute()` – Single Execution
Graph executes once until all computations complete, then stops. Results available via `exportState()` after completion. Supports `importState()` and `exportState()` for state management.

### `run()` – Long-running Mode
Graph runs continuously until stopped. Results via subscription handlers. Supports dynamic updates:
- `updateGraph()` – When graph structure changes (nodes added/removed, dependencies change)
- `updateNode()` – When only node config/data changes (e.g., webhook data, operation in plugin changed)

## Parallel Execution

Optional parallel execution via **Worker Threads** (Node.js) or **Web Workers** (browser). Enable with `executionMode: EngineExecutionMode.PARALLEL` in `withOptions()`; configure pool and script via `parallelOptions` (e.g. `maxWorkers`, `workerPath` / `workerScriptUrl`).

- **Limitation:** In parallel mode only plugin types implemented inside the worker script run in workers; custom plugins from the main registry are not transferred (structured clone cannot send functions). Use the built-in worker or supply your own script.
- **Node.js:** Worker script is resolved in order: `options.workerPath` → packaged `dist/worker.js` (export `dexrx/worker`) → test/dev paths → inline fallback. Load balancing: **least-loaded** (task goes to worker with fewest pending tasks).
- **Browser:** Worker URL must be provided (`workerScriptUrl`). Load balancing: **round-robin**.

## Node Types

In a DexRx graph, there are two types of nodes:

### Data Nodes
**Independent nodes** (leaves in the graph) that obtain data from external sources.

- No inputs
- Source nodes that obtain data from external systems (APIs, databases, webhooks, etc.)

### Operational Nodes
**Dependent nodes** that process and transform data from other nodes.

- Have one or more inputs (depend on other nodes)
- Transform or compute values based on inputs (transformation/computation logic is determined by node plugin)
- Automatically recalculate when input values change

## Engine Hooks

DexRx provides an event hook system for monitoring graph lifecycle and node events. Subscribe to events using `on(eventType, handler)` method on `ExecutableGraph` instance.

**Event Categories:**
- **Node Events** - Node lifecycle and computation events
- **Lifecycle Events** - Engine state transitions
- **Monitoring Events** - Health checks and threshold monitoring

The `on()` method returns an unsubscribe function. Hooks are available after engine creation (after `execute()` or `run()` is called).

## Quick Start

### Example Plugins

```typescript
import type { INodePlugin } from '@legann/dexrx';

// Fetch plugin - HTTP requests (data node)
const fetchPlugin: INodePlugin = {
    type: 'fetch',
  category: 'data',
  compute: async (config: { url: string; poll?: number }, inputs) => {
    const response = await fetch(config.url);
    return response.json();
  }
};

// Math plugin - mathematical operations (operational node)
const mathPlugin: INodePlugin = {
    type: 'math',
  category: 'operational',
  compute: (config: { op: string; value?: number }, inputs) => {
    const inputValue = inputs[0] || 0;
    const opValue = config.value || 0;
    
    switch (config.op) {
      case 'ADD': return inputValue + opValue;
      case 'SUBTRACT': return inputValue - opValue;
      case 'MULTIPLY': return inputValue * opValue;
      case 'DIVIDE': return inputValue / opValue;
      default: return inputValue;
    }
  }
};

// Webhook plugin - receives external data via config (data node, updated through updateNode())
const webhookPlugin: INodePlugin = {
  type: 'webhook',
  category: 'data',
  compute: (config: { data?: any }, inputs) => {
    // Data is passed through config.data when webhook endpoint calls updateNode()
    return config.data || null;
  }
};
```

### Single Execution (`execute()`)

```typescript
import { createGraph, withNodesConfig } from '@legann/dexrx';

const graph = createGraph(
  withNodesConfig({
    nodesPlugins: [fetchPlugin, mathPlugin],
    nodes: [
      { id: 'fetch1', type: 'fetch', config: { url: 'https://api.example.com/data' } },
      { id: 'math1', type: 'math', inputs: ['fetch1'], config: { op: 'ADD', value: 10 } }
    ]
  })
);

await graph.execute();

const state = graph.exportState();
console.log('Result:', state.nodes['math1'].currentValue);
```

### Long-running Graph (`run()`)

```typescript
import { createGraph, withNodesConfig } from '@legann/dexrx';

const graph = createGraph(
  withNodesConfig({
    nodesPlugins: [webhookPlugin, mathPlugin],
    nodes: [
      { id: 'webhook1', type: 'webhook', config: {} },
      { id: 'math1', type: 'math', inputs: ['webhook1'], config: { op: 'ADD', value: 10, isSubscribed: true } }
    ],
    subscriptions: {
      math1: (value, nodeId) => {
        console.log(`Node ${nodeId} emitted:`, value);
      }
    }
  })
);

const longRunning = graph.run();

// Graph runs continuously, subscription handlers called on updates

// When webhook receives data, update only the webhook node (preserves graph structure)
app.post('/webhook', async (req, res) => {
  longRunning.updateNode('webhook1', {
    id: 'webhook1',
    type: 'webhook',
    config: { data: req.body, isSubscribed: true }
  });
  // Dependent nodes automatically recalculate!
  res.send({ ok: true });
});

// To change graph structure (add/remove nodes), use updateGraph()
longRunning.updateGraph([
  { id: 'fetch1', type: 'fetch', config: { url: 'https://api.example.com/data', isSubscribed: true } }
]);

// Stop when done
longRunning.stop();
```

## License

MIT © [legann](https://github.com/legann)

See [LICENSE](./LICENSE) for details.
