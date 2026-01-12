import { createGraph, ExecutableGraph } from '../lib/dexrx/src/graph';
import { withNodesConfig, withPersistence, withNotifications } from '../lib/dexrx/src/operators';
import { MemoryStateProvider } from '../lib/dexrx/src/providers/memory/persistence';
import type { IPersistenceProvider, INotificationProvider } from '../lib/dexrx/src/graph';
import type { EngineStateSnapshot } from '../lib/dexrx/src/types/engine-api';
import { INodePlugin } from 'dexrx';

describe('ExecutableGraph Provider API', () => {
  const sourcePlugin: INodePlugin = {
    type: 'source',
    category: 'data',
    compute: (_config: unknown, _inputs: unknown[]) => 10,
  };

  describe('Persistence Methods', () => {
    it('should save state using persistence provider', async () => {
      const persistenceProvider = new MemoryStateProvider();
      
      const graph = createGraph(
        withPersistence(persistenceProvider),
        withNodesConfig({
          nodesPlugins: [sourcePlugin],
          nodes: [
            { id: 'a', type: 'source', config: { value: 10 } }
          ]
        })
      );

      await graph.execute();
      await new Promise(resolve => setTimeout(resolve, 50));

      await graph.saveState('test-key', { ttl: 3600 });
      
      const loaded = await persistenceProvider.loadState<EngineStateSnapshot>('test-key');
      expect(loaded).toBeDefined();
      expect(loaded?.nodes).toBeDefined();
      expect(loaded?.nodes['a']).toBeDefined();
    });

    it('should load state using persistence provider', async () => {
      const persistenceProvider = new MemoryStateProvider();
      
      const graph1 = createGraph(
        withPersistence(persistenceProvider),
        withNodesConfig({
          nodesPlugins: [sourcePlugin],
          nodes: [
            { id: 'a', type: 'source', config: { value: 10 } }
          ]
        })
      );

      await graph1.execute();
      await graph1.saveState('test-key');

      // Load in new graph
      const graph2 = createGraph(
        withPersistence(persistenceProvider),
        withNodesConfig({
          nodesPlugins: [sourcePlugin],
          nodes: [
            { id: 'a', type: 'source', config: { value: 10 } }
          ]
        })
      );

      const state = await graph2.loadState<EngineStateSnapshot>('test-key');
      expect(state).toBeDefined();
      expect(state?.nodes).toBeDefined();
      
      if (state) {
        await graph2.importState(state);
        expect(graph2.getState()).toBeDefined();
      }
    });

    it('should throw error if persistence provider not registered', async () => {
      const graph = createGraph(
        withNodesConfig({
          nodesPlugins: [sourcePlugin],
          nodes: [
            { id: 'a', type: 'source', config: { value: 10 } }
          ]
        })
      );

      await expect(graph.saveState('test-key')).rejects.toThrow(
        'Persistence provider not registered'
      );

      await expect(graph.loadState('test-key')).rejects.toThrow(
        'Persistence provider not registered'
      );

      await expect(graph.deleteState('test-key')).rejects.toThrow(
        'Persistence provider not registered'
      );
    });

    it('should delete state using persistence provider', async () => {
      const persistenceProvider = new MemoryStateProvider();
      
      const graph = createGraph(
        withPersistence(persistenceProvider),
        withNodesConfig({
          nodesPlugins: [sourcePlugin],
          nodes: [
            { id: 'a', type: 'source', config: { value: 10 } }
          ]
        })
      );

      await graph.execute();
      await new Promise(resolve => setTimeout(resolve, 50));
      await graph.saveState('test-key');
      
      // Verify saved
      const beforeDelete = await persistenceProvider.loadState('test-key');
      expect(beforeDelete).toBeDefined();
      
      await graph.deleteState('test-key');
      
      // Verify deleted
      const afterDelete = await persistenceProvider.loadState('test-key');
      expect(afterDelete).toBeNull();
    });

    it('should save state with TTL', async () => {
      const persistenceProvider = new MemoryStateProvider();
      
      const graph = createGraph(
        withPersistence(persistenceProvider),
        withNodesConfig({
          nodesPlugins: [sourcePlugin],
          nodes: [
            { id: 'a', type: 'source', config: { value: 10 } }
          ]
        })
      );

      await graph.execute();
      await new Promise(resolve => setTimeout(resolve, 50));
      
      await graph.saveState('test-key', { ttl: 1 }); // 1 second TTL
      
      const loaded = await persistenceProvider.loadState('test-key');
      expect(loaded).toBeDefined();
      
      // Wait for TTL to expire
      await new Promise(resolve => setTimeout(resolve, 1100));
      
      const expired = await persistenceProvider.loadState('test-key');
      expect(expired).toBeNull();
    });
  });

  describe('Notification Methods', () => {
    it('should send notification using notification provider', async () => {
      const notifySpy = jest.fn();
      const notificationProvider: INotificationProvider = {
        async notify(connectionId: string, data: unknown) {
          notifySpy(connectionId, data);
        },
        async broadcast() {},
        async subscribe() {},
        async unsubscribe() {}
      };

      const graph = createGraph(
        withNotifications(notificationProvider),
        withNodesConfig({
          nodesPlugins: [sourcePlugin],
          nodes: [
            { id: 'a', type: 'source', config: { value: 10 } }
          ]
        })
      );

      await graph.notify('conn-123', { type: 'update', data: 'test' });
      
      expect(notifySpy).toHaveBeenCalledWith('conn-123', { type: 'update', data: 'test' });
      expect(notifySpy).toHaveBeenCalledTimes(1);
    });

    it('should broadcast using notification provider', async () => {
      const broadcastSpy = jest.fn();
      const notificationProvider: INotificationProvider = {
        async notify() {},
        async broadcast(topic: string, data: unknown) {
          broadcastSpy(topic, data);
        },
        async subscribe() {},
        async unsubscribe() {}
      };

      const graph = createGraph(
        withNotifications(notificationProvider),
        withNodesConfig({
          nodesPlugins: [sourcePlugin],
          nodes: [
            { id: 'a', type: 'source', config: { value: 10 } }
          ]
        })
      );

      const updates = { type: 'batch_update', updates: { node1: { value: 10 } } };
      await graph.broadcast('tenant-123', updates);
      
      expect(broadcastSpy).toHaveBeenCalledWith('tenant-123', updates);
      expect(broadcastSpy).toHaveBeenCalledTimes(1);
    });

    it('should subscribe connection to topic', async () => {
      const subscribeSpy = jest.fn();
      const notificationProvider: INotificationProvider = {
        async notify() {},
        async broadcast() {},
        async subscribe(connectionId: string, topic: string) {
          subscribeSpy(connectionId, topic);
        },
        async unsubscribe() {}
      };

      const graph = createGraph(
        withNotifications(notificationProvider),
        withNodesConfig({
          nodesPlugins: [sourcePlugin],
          nodes: [
            { id: 'a', type: 'source', config: { value: 10 } }
          ]
        })
      );

      await graph.subscribe('conn-123', 'tenant-456');
      
      expect(subscribeSpy).toHaveBeenCalledWith('conn-123', 'tenant-456');
      expect(subscribeSpy).toHaveBeenCalledTimes(1);
    });

    it('should unsubscribe connection from topic', async () => {
      const unsubscribeSpy = jest.fn();
      const notificationProvider: INotificationProvider = {
        async notify() {},
        async broadcast() {},
        async subscribe() {},
        async unsubscribe(connectionId: string, topic: string) {
          unsubscribeSpy(connectionId, topic);
        }
      };

      const graph = createGraph(
        withNotifications(notificationProvider),
        withNodesConfig({
          nodesPlugins: [sourcePlugin],
          nodes: [
            { id: 'a', type: 'source', config: { value: 10 } }
          ]
        })
      );

      await graph.unsubscribe('conn-123', 'tenant-456');
      
      expect(unsubscribeSpy).toHaveBeenCalledWith('conn-123', 'tenant-456');
      expect(unsubscribeSpy).toHaveBeenCalledTimes(1);
    });

    it('should throw error if notification provider not registered', async () => {
      const graph = createGraph(
        withNodesConfig({
          nodesPlugins: [sourcePlugin],
          nodes: [
            { id: 'a', type: 'source', config: { value: 10 } }
          ]
        })
      );

      await expect(graph.notify('conn-123', {})).rejects.toThrow(
        'Notification provider not registered'
      );

      await expect(graph.broadcast('topic', {})).rejects.toThrow(
        'Notification provider not registered'
      );

      await expect(graph.subscribe('conn-123', 'topic')).rejects.toThrow(
        'Notification provider not registered'
      );

      await expect(graph.unsubscribe('conn-123', 'topic')).rejects.toThrow(
        'Notification provider not registered'
      );
    });
  });

  describe('Combined Usage', () => {
    it('should work with both persistence and notification providers', async () => {
      const persistenceProvider = new MemoryStateProvider();
      const notifySpy = jest.fn();
      const broadcastSpy = jest.fn();
      
      const notificationProvider: INotificationProvider = {
        async notify(connectionId: string, data: unknown) {
          notifySpy(connectionId, data);
        },
        async broadcast(topic: string, data: unknown) {
          broadcastSpy(topic, data);
        },
        async subscribe() {},
        async unsubscribe() {}
      };

      const graph = createGraph(
        withPersistence(persistenceProvider),
        withNotifications(notificationProvider),
        withNodesConfig({
          nodesPlugins: [sourcePlugin],
          nodes: [
            { id: 'a', type: 'source', config: { value: 10 } }
          ]
        })
      );

      await graph.execute();
      await new Promise(resolve => setTimeout(resolve, 50));

      // Save state
      await graph.saveState('test-key');
      
      // Send notifications
      await graph.notify('conn-123', { type: 'update' });
      await graph.broadcast('tenant-456', { type: 'broadcast' });

      // Verify persistence
      const loaded = await graph.loadState('test-key');
      expect(loaded).toBeDefined();

      // Verify notifications
      expect(notifySpy).toHaveBeenCalledWith('conn-123', { type: 'update' });
      expect(broadcastSpy).toHaveBeenCalledWith('tenant-456', { type: 'broadcast' });
    });
  });
});

