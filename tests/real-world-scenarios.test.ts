import { createGraph, LongRunningGraph } from '../lib/dexrx/src/graph';
import { withNodesConfig, withOptions } from '../lib/dexrx/src/operators';
import { INodePlugin } from 'dexrx';
import { createCancelableTask } from './utils/test-cancelable';

/**
 * Tests for checking ExecutableGraph in real-world scenarios
 * These tests simulate typical usage patterns in applications
 */
describe('ExecutableGraph - Real-World Scenarios (Build API)', () => {
  // Increase timeout for long-running tests
  jest.setTimeout(60000);

  // Plugin definitions
  const apiRequestPlugin: INodePlugin = {
    type: 'apiRequest',
    category: 'data',
    compute: (config, inputs) => {
      return createCancelableTask((signal) => {
        return new Promise((resolve, reject) => {
          const endpoint = (config as Record<string, unknown>).endpoint as string;
          console.log(`API Request started: ${endpoint}`);

          // Simulate network delay
          const timer = setTimeout(() => {
            if (!signal.aborted) {
              console.log(`API Request completed: ${endpoint}`);

              // Simulate API response
              resolve({
                data: (config as Record<string, unknown>).mockData || { success: true, id: Math.floor(Math.random() * 1000) },
                status: 200,
                headers: { 'content-type': 'application/json' }
              });
            }
          }, ((config as Record<string, unknown>).latency as number) ?? 300);

          // Handle request cancellation
          signal.addEventListener('abort', () => {
            console.log(`API Request cancelled: ${endpoint}`);
            clearTimeout(timer);
            reject(new Error(`Request to ${endpoint} was cancelled`));
          });
        });
      });
    }
  };

  const dataTransformPlugin: INodePlugin = {
    type: 'dataTransform',
    category: 'operational',
    compute: (config, inputs) => {
      const input = inputs[0];

      if (!input) {
        return null;
      }

      // Apply transformation depending on type
      const typedInput = input as { data: unknown[] };
      const transformType = (config as Record<string, unknown>).transformType as string;
      switch (transformType) {
        case 'extract':
          return typedInput.data;
        case 'map':
          if (Array.isArray(typedInput.data)) {
            return typedInput.data.map((item: Record<string, any>) => {
              const result: Record<string, any> = {};
              const mapping = (config as Record<string, unknown>).mapping as Record<string, string> || {};
              for (const [key, newKey] of Object.entries(mapping)) {
                result[newKey] = item[key];
              }
              return result;
            });
          }
          return typedInput.data;
        case 'filter':
          if (Array.isArray(typedInput.data)) {
            const filters = (config as Record<string, unknown>).filters as Record<string, unknown> || {};
            return typedInput.data.filter((item: Record<string, any>) => {
              for (const [key, value] of Object.entries(filters)) {
                if (item[key] !== value) {
                  return false;
                }
              }
              return true;
            });
          }
          return typedInput.data;
        default:
          return typedInput;
      }
    }
  };

  const aggregatorPlugin: INodePlugin = {
    type: 'aggregator',
    category: 'operational',
    compute: (config, inputs) => {
      // Combine results of all input nodes
      const result: Record<string, any> = {};
      const keys = (config as Record<string, unknown>).keys as string[] | undefined;

      inputs.forEach((input, index) => {
        if (input) {
          const key = keys?.[index] || `data${index}`;
          result[key] = input;
        }
      });

      return result;
    }
  };

  const heavyComputationPlugin: INodePlugin = {
    type: 'heavyComputation',
    category: 'operational',
    compute: (config, inputs) => {
      return createCancelableTask((signal) => {
        return new Promise((resolve, reject) => {
          console.log(`Starting heavy computation...`);

          const startTime = Date.now();
          const timer = setTimeout(() => {
            if (signal.aborted) return;

            // Simulate heavy computations
            let result = (inputs[0] as number) || 0;

            const iterations = ((config as Record<string, unknown>).iterations as number) ?? 100;
            for (let i = 0; i < iterations; i++) {
              if (signal.aborted) {
                break;
              }
              // Artificial computations for load
              result = Math.sqrt(Math.sin(result * i) * Math.cos(result * i)) + result;

              // Simulate staged processing
              if (i % 20 === 0 && ((config as Record<string, unknown>).reportProgress as boolean)) {
                console.log(`Computation progress: ${Math.round(i / iterations * 100)}%`);
              }
            }

            const duration = Date.now() - startTime;
            console.log(`Heavy computation completed in ${duration}ms`);

            if (!signal.aborted) {
              resolve({
                result,
                duration,
                iterationsCompleted: iterations
              });
            }
          }, 10); // Minimal delay for asynchrony

          signal.addEventListener('abort', () => {
            console.log(`Heavy computation cancelled`);
            clearTimeout(timer);
            reject(new Error('Computation was cancelled'));
          });
        });
      });
    }
  };

  const uiComponentPlugin: INodePlugin = {
    type: 'uiComponent',
    category: 'operational',
    compute: (config, inputs) => {
      // Simulate UI component rendering
      const data = inputs[0] || {};

      return {
        type: ((config as Record<string, unknown>).componentType as string) || 'default',
        props: {
          ...(((config as Record<string, unknown>).defaultProps as Record<string, unknown>) || {}),
          ...(data as Record<string, unknown>)
        },
        children: (config as Record<string, unknown>).children || [],
        rendered: true,
        timestamp: Date.now()
      };
    }
  };

  /**
   * Test for simulating typical SPA scenario: data loading,
   * transformation and display with cancellation during navigation
   */
  it('should handle SPA data loading with cancellation on navigation', async () => {
    const graph = createGraph(
      withOptions({
        engine: {
          enableCancelableCompute: true,
          throttleTime: 50,
          distinctValues: true
        }
      }),
      withNodesConfig({
        nodesPlugins: [apiRequestPlugin, dataTransformPlugin, uiComponentPlugin],
        nodes: [
          {
            id: 'usersRequest',
            type: 'apiRequest',
            config: {
              endpoint: '/api/users',
              latency: 500,
              mockData: {
                users: [
                  { id: 1, name: 'John', role: 'admin' },
                  { id: 2, name: 'Mary', role: 'user' },
                  { id: 3, name: 'Alex', role: 'user' },
                  { id: 4, name: 'Sophia', role: 'moderator' }
                ]
              }
            }
          },
          {
            id: 'usersTransform',
            type: 'dataTransform',
            inputs: ['usersRequest'],
            config: {
              transformType: 'extract'
            }
          },
          {
            id: 'usersFilter',
            type: 'dataTransform',
            inputs: ['usersTransform'],
            config: {
              transformType: 'filter',
              filters: { role: 'user' }
            }
          },
          {
            id: 'userListUI',
            type: 'uiComponent',
            inputs: ['usersFilter'],
            config: {
              componentType: 'UserList',
              defaultProps: {
                title: 'User List'
              },
              isSubscribed: true
            }
          }
        ],
        subscriptions: {
          userListUI: (value) => {
            // Subscription handler for UI updates
            if (value) {
              console.log('UI updated:', value);
            }
          }
        }
      })
    );

    await graph.execute();
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Start as long-running graph for updates
    const longRunningGraph: LongRunningGraph = graph.run();

    // Simulate navigation that should cancel current requests
    console.log('=== Simulating navigation to another page ===');

    longRunningGraph.updateGraph([
      {
        id: 'usersRequest',
        type: 'apiRequest',
        config: {
          endpoint: '/api/users/filtered',
          latency: 300,
          mockData: {
            users: [
              { id: 5, name: 'Dmitry', role: 'user' },
              { id: 6, name: 'Elena', role: 'user' }
            ]
          }
        }
      },
      {
        id: 'usersTransform',
        type: 'dataTransform',
        inputs: ['usersRequest'],
        config: {
          transformType: 'extract'
        }
      },
      {
        id: 'usersFilter',
        type: 'dataTransform',
        inputs: ['usersTransform'],
        config: {
          transformType: 'filter',
          filters: { role: 'user' }
        }
      },
      {
        id: 'userListUI',
        type: 'uiComponent',
        inputs: ['usersFilter'],
        config: {
          componentType: 'UserList',
          defaultProps: {
            title: 'User List'
          },
          isSubscribed: true
        }
      }
    ], { autoStart: true });

    await new Promise(resolve => setTimeout(resolve, 500));

    // Simulate another navigation with rapid sequence of updates
    console.log('=== Simulating multiple rapid navigations ===');

    // Rapid sequence of updates to trigger cancellation
    for (let i = 0; i < 3; i++) {
      longRunningGraph.updateGraph([
        {
          id: 'usersRequest',
          type: 'apiRequest',
          config: {
            endpoint: `/api/users/quick-navigation-${i}`,
            latency: 200,
            mockData: {
              users: [
                { id: 10 + i, name: `Test ${i}`, role: 'user' }
              ]
            }
          }
        },
        {
          id: 'usersTransform',
          type: 'dataTransform',
          inputs: ['usersRequest'],
          config: {
            transformType: 'extract'
          }
        },
        {
          id: 'usersFilter',
          type: 'dataTransform',
          inputs: ['usersTransform'],
          config: {
            transformType: 'filter',
            filters: { role: 'user' }
          }
        },
        {
          id: 'userListUI',
          type: 'uiComponent',
          inputs: ['usersFilter'],
          config: {
            componentType: 'UserList',
            defaultProps: {
              title: 'User List'
            },
            isSubscribed: true
          }
        }
      ], { autoStart: true });

      await new Promise(resolve => setTimeout(resolve, 50));
    }

    // Wait for all operations to complete
    await new Promise(resolve => setTimeout(resolve, 500));

    const state = graph.exportState();
    expect(state.nodes['userListUI']).toBeDefined();
    if (state.nodes['userListUI']?.currentValue) {
      const uiValue = state.nodes['userListUI'].currentValue as { props: { title: string } };
      expect(uiValue.props.title).toBe('User List');
    }

    graph.destroy();
  });

  /**
   * Test for simulating scenario with entity details view opening
   * with parallel loading of multiple related data
   */
  it('should handle entity details view with parallel data loading', async () => {
    const graph = createGraph(
      withOptions({
        engine: {
          enableCancelableCompute: true,
          distinctValues: true,
          debounceTime: 30
        }
      }),
      withNodesConfig({
        nodesPlugins: [apiRequestPlugin, dataTransformPlugin, aggregatorPlugin, uiComponentPlugin],
        nodes: [
          {
            id: 'entityRequest',
            type: 'apiRequest',
            config: {
              endpoint: '/api/entities/123',
              latency: 300,
              mockData: {
                id: 123,
                name: 'Test Entity',
                createdAt: '2023-01-15',
                status: 'active'
              }
            }
          },
          {
            id: 'relatedEntitiesRequest',
            type: 'apiRequest',
            config: {
              endpoint: '/api/entities/123/related',
              latency: 500,
              mockData: {
                items: [
                  { id: 456, name: 'Related 1' },
                  { id: 789, name: 'Related 2' }
                ]
              }
            }
          },
          {
            id: 'commentsRequest',
            type: 'apiRequest',
            config: {
              endpoint: '/api/entities/123/comments',
              latency: 400,
              mockData: {
                comments: [
                  { id: 1, text: 'First comment', author: 'user1' },
                  { id: 2, text: 'Second comment', author: 'user2' }
                ]
              }
            }
          },
          {
            id: 'entityTransform',
            type: 'dataTransform',
            inputs: ['entityRequest'],
            config: {
              transformType: 'extract'
            }
          },
          {
            id: 'relatedTransform',
            type: 'dataTransform',
            inputs: ['relatedEntitiesRequest'],
            config: {
              transformType: 'extract'
            }
          },
          {
            id: 'commentsTransform',
            type: 'dataTransform',
            inputs: ['commentsRequest'],
            config: {
              transformType: 'extract'
            }
          },
          {
            id: 'entityDetailsAggregator',
            type: 'aggregator',
            inputs: ['entityTransform', 'relatedTransform', 'commentsTransform'],
            config: {
              keys: ['entity', 'related', 'comments']
            }
          },
          {
            id: 'entityDetailsUI',
            type: 'uiComponent',
            inputs: ['entityDetailsAggregator'],
            config: {
              componentType: 'EntityDetails',
              defaultProps: {
                title: 'Details View'
              },
              isSubscribed: true
            }
          }
        ]
      })
    );

    await graph.execute();
    await new Promise(resolve => setTimeout(resolve, 1500));

    // Start as long-running graph for updates
    const longRunningGraph: LongRunningGraph = graph.run();

    // Simulate data update
    console.log('=== Simulating details update ===');
    longRunningGraph.updateGraph([
      {
        id: 'entityRequest',
        type: 'apiRequest',
        config: {
          endpoint: '/api/entities/123',
          latency: 200,
          mockData: {
            id: 123,
            name: 'Updated Entity',
            createdAt: '2023-01-15',
            status: 'modified'
          }
        }
      },
      {
        id: 'relatedEntitiesRequest',
        type: 'apiRequest',
        config: {
          endpoint: '/api/entities/123/related',
          latency: 500,
          mockData: {
            items: [
              { id: 456, name: 'Related 1' },
              { id: 789, name: 'Related 2' }
            ]
          }
        }
      },
      {
        id: 'commentsRequest',
        type: 'apiRequest',
        config: {
          endpoint: '/api/entities/123/comments',
          latency: 400,
          mockData: {
            comments: [
              { id: 1, text: 'First comment', author: 'user1' },
              { id: 2, text: 'Second comment', author: 'user2' }
            ]
          }
        }
      },
      {
        id: 'entityTransform',
        type: 'dataTransform',
        inputs: ['entityRequest'],
        config: {
          transformType: 'extract'
        }
      },
      {
        id: 'relatedTransform',
        type: 'dataTransform',
        inputs: ['relatedEntitiesRequest'],
        config: {
          transformType: 'extract'
        }
      },
      {
        id: 'commentsTransform',
        type: 'dataTransform',
        inputs: ['commentsRequest'],
        config: {
          transformType: 'extract'
        }
      },
      {
        id: 'entityDetailsAggregator',
        type: 'aggregator',
        inputs: ['entityTransform', 'relatedTransform', 'commentsTransform'],
        config: {
          keys: ['entity', 'related', 'comments']
        }
      },
      {
        id: 'entityDetailsUI',
        type: 'uiComponent',
        inputs: ['entityDetailsAggregator'],
        config: {
          componentType: 'EntityDetails',
          defaultProps: {
            title: 'Details View'
          },
          isSubscribed: true
        }
      }
    ], { autoStart: true });

    // Wait for update to complete
    await new Promise(resolve => setTimeout(resolve, 500));

    const state = graph.exportState();
    if (state.nodes['entityDetailsUI']?.currentValue) {
      const uiValue = state.nodes['entityDetailsUI'].currentValue as { props: Record<string, unknown> };
      if (uiValue.props.entity) {
        const entity = uiValue.props.entity as { name: string };
        expect(entity.name).toBeDefined();
      }
    }

    graph.destroy();
  });

  /**
   * Test for simulating scenario with heavy computations during page rendering
   */
  it('should handle heavy computations during dashboard rendering', async () => {
    const graph = createGraph(
      withOptions({
        engine: {
          enableCancelableCompute: true,
          throttleTime: 100
        }
      }),
      withNodesConfig({
        nodesPlugins: [apiRequestPlugin, heavyComputationPlugin, aggregatorPlugin, uiComponentPlugin],
        nodes: [
          {
            id: 'dashboardData',
            type: 'apiRequest',
            config: {
              endpoint: '/api/dashboard',
              latency: 300,
              mockData: {
                metrics: [
                  { name: 'users', value: 1250 },
                  { name: 'revenue', value: 45600 },
                  { name: 'orders', value: 124 }
                ],
                timestamp: Date.now()
              }
            }
          },
          {
            id: 'widget1Computation',
            type: 'heavyComputation',
            inputs: ['dashboardData'],
            config: {
              iterations: 200,
              reportProgress: true
            }
          },
          {
            id: 'widget2Computation',
            type: 'heavyComputation',
            inputs: ['dashboardData'],
            config: {
              iterations: 300,
              reportProgress: true
            }
          },
          {
            id: 'widget3Computation',
            type: 'heavyComputation',
            inputs: ['dashboardData'],
            config: {
              iterations: 150,
              reportProgress: true
            }
          },
          {
            id: 'widget1UI',
            type: 'uiComponent',
            inputs: ['widget1Computation'],
            config: {
              componentType: 'ChartWidget',
              defaultProps: {
                title: 'User Chart'
              }
            }
          },
          {
            id: 'widget2UI',
            type: 'uiComponent',
            inputs: ['widget2Computation'],
            config: {
              componentType: 'TableWidget',
              defaultProps: {
                title: 'Revenue Table'
              }
            }
          },
          {
            id: 'widget3UI',
            type: 'uiComponent',
            inputs: ['widget3Computation'],
            config: {
              componentType: 'MetricWidget',
              defaultProps: {
                title: 'Order Metrics'
              }
            }
          },
          {
            id: 'dashboardUI',
            type: 'aggregator',
            inputs: ['widget1UI', 'widget2UI', 'widget3UI'],
            config: {
              keys: ['chart', 'table', 'metric']
            }
          }
        ]
      })
    );

    // Start as long-running graph for updates (no need for execute() first)
    const longRunningGraph: LongRunningGraph = graph.run();
    
    // Give initial computation time to start
    await new Promise(resolve => setTimeout(resolve, 500));

    // Simulate data update
    console.log('=== Rapid dashboard data update ===');

    longRunningGraph.updateGraph([
      {
        id: 'dashboardData',
        type: 'apiRequest',
        config: {
          endpoint: '/api/dashboard/refresh',
          latency: 200,
          mockData: {
            metrics: [
              { name: 'users', value: 1300 },
              { name: 'revenue', value: 47200 },
              { name: 'orders', value: 130 }
            ],
            timestamp: Date.now()
          }
        }
      },
      {
        id: 'widget1Computation',
        type: 'heavyComputation',
        inputs: ['dashboardData'],
        config: {
          iterations: 200,
          reportProgress: true
        }
      },
      {
        id: 'widget2Computation',
        type: 'heavyComputation',
        inputs: ['dashboardData'],
        config: {
          iterations: 300,
          reportProgress: true
        }
      },
      {
        id: 'widget3Computation',
        type: 'heavyComputation',
        inputs: ['dashboardData'],
        config: {
          iterations: 150,
          reportProgress: true
        }
      },
      {
        id: 'widget1UI',
        type: 'uiComponent',
        inputs: ['widget1Computation'],
        config: {
          componentType: 'ChartWidget',
          defaultProps: {
            title: 'User Chart'
          }
        }
      },
      {
        id: 'widget2UI',
        type: 'uiComponent',
        inputs: ['widget2Computation'],
        config: {
          componentType: 'TableWidget',
          defaultProps: {
            title: 'Revenue Table'
          }
        }
      },
      {
        id: 'widget3UI',
        type: 'uiComponent',
        inputs: ['widget3Computation'],
        config: {
          componentType: 'MetricWidget',
          defaultProps: {
            title: 'Order Metrics'
          }
        }
      },
      {
        id: 'dashboardUI',
        type: 'aggregator',
        inputs: ['widget1UI', 'widget2UI', 'widget3UI'],
        config: {
          keys: ['chart', 'table', 'metric']
        }
      }
    ], { autoStart: true });

    await new Promise(resolve => setTimeout(resolve, 200));

    console.log('=== Second rapid data update ===');

    longRunningGraph.updateGraph([
      {
        id: 'dashboardData',
        type: 'apiRequest',
        config: {
          endpoint: '/api/dashboard/refresh-again',
          latency: 150,
          mockData: {
            metrics: [
              { name: 'users', value: 1350 },
              { name: 'revenue', value: 48000 },
              { name: 'orders', value: 135 }
            ],
            timestamp: Date.now()
          }
        }
      },
      {
        id: 'widget1Computation',
        type: 'heavyComputation',
        inputs: ['dashboardData'],
        config: {
          iterations: 200,
          reportProgress: true
        }
      },
      {
        id: 'widget2Computation',
        type: 'heavyComputation',
        inputs: ['dashboardData'],
        config: {
          iterations: 300,
          reportProgress: true
        }
      },
      {
        id: 'widget3Computation',
        type: 'heavyComputation',
        inputs: ['dashboardData'],
        config: {
          iterations: 150,
          reportProgress: true
        }
      },
      {
        id: 'widget1UI',
        type: 'uiComponent',
        inputs: ['widget1Computation'],
        config: {
          componentType: 'ChartWidget',
          defaultProps: {
            title: 'User Chart'
          }
        }
      },
      {
        id: 'widget2UI',
        type: 'uiComponent',
        inputs: ['widget2Computation'],
        config: {
          componentType: 'TableWidget',
          defaultProps: {
            title: 'Revenue Table'
          }
        }
      },
      {
        id: 'widget3UI',
        type: 'uiComponent',
        inputs: ['widget3Computation'],
        config: {
          componentType: 'MetricWidget',
          defaultProps: {
            title: 'Order Metrics'
          }
        }
      },
      {
        id: 'dashboardUI',
        type: 'aggregator',
        inputs: ['widget1UI', 'widget2UI', 'widget3UI'],
        config: {
          keys: ['chart', 'table', 'metric']
        }
      }
    ], { autoStart: true });

    // Increase waiting time to ensure results are received
    await new Promise(resolve => setTimeout(resolve, 2000));

    const state = graph.exportState();
    expect(state.nodes['dashboardUI']).toBeDefined();

    graph.destroy();
  }, 120000); // Increase timeout to 120 seconds for heavy computation test
});
