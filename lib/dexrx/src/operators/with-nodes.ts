import type { GraphOperator, NodeDefinition } from '../graph';
import type { INodeDefinition } from '../types/node-definition';

/**
 * Adds multiple nodes from INodeDefinition array to the graph
 * Automatically performs topological sort to ensure nodes are added in correct dependency order
 * Uses registered plugins from withNodePlugins() operator
 *
 * @param nodes - Array of node definitions to add
 *
 * @example
 * ```typescript
 * const graph = createGraph(
 *   withNodePlugins(plugins),
 *   withNodes([
 *     { id: 'fetch1', type: 'fetch', config: { url: '...' } },
 *     { id: 'fetch2', type: 'fetch', config: { url: '...' } },
 *     { id: 'math1', type: 'math', inputs: ['fetch1', 'fetch2'], config: { op: 'ADD' } }
 *   ])
 * );
 * ```
 */
export function withNodes(nodes: INodeDefinition[]): GraphOperator {
  return graph => {
    if (nodes.length === 0) {
      return graph;
    }

    // Topological sort: nodes without inputs first, then nodes with inputs
    const sortedNodes = topologicalSort(nodes);

    // Add nodes in sorted order
    let currentGraph = graph;

    for (const nodeDef of sortedNodes) {
      // Check if node already exists
      if (currentGraph.nodes.has(nodeDef.id)) {
        throw new Error(`Node with id '${nodeDef.id}' already exists`);
      }

      // Validate that all input nodes exist
      if (nodeDef.inputs) {
        for (const inputId of nodeDef.inputs) {
          if (!currentGraph.nodes.has(inputId)) {
            throw new Error(`Input node '${inputId}' not found for node '${nodeDef.id}'`);
          }
        }
      }

      // Create Build API node definition
      // We don't set computeFunction - the node will use its type to find the plugin
      // in the registry when converted to graph engine format
      const node: NodeDefinition = {
        id: nodeDef.id,
        type: nodeDef.type, // Use the plugin type directly
        inputs: nodeDef.inputs ? [...nodeDef.inputs] : [],
        config: { ...nodeDef.config },
        // No computeFunction - will use plugin from registry
      };

      // Update edges map
      const edges = new Map(currentGraph.edges);
      if (nodeDef.inputs && nodeDef.inputs.length > 0) {
        edges.set(nodeDef.id, nodeDef.inputs);
      }

      // Add node to graph
      currentGraph = {
        ...currentGraph,
        nodes: new Map([...currentGraph.nodes, [nodeDef.id, node]]),
        edges,
      };
    }

    return currentGraph;
  };
}

/**
 * Topological sort for INodeDefinition array
 * Ensures nodes without inputs are added before nodes that depend on them
 * Detects cycles and throws an error if found
 */
function topologicalSort(nodes: INodeDefinition[]): INodeDefinition[] {
  const sorted: INodeDefinition[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();

  const visit = (node: INodeDefinition): void => {
    if (visiting.has(node.id)) {
      throw new Error(`Cycle detected in graph: ${node.id}`);
    }
    if (visited.has(node.id)) {
      return;
    }

    visiting.add(node.id);

    // Visit all input nodes first
    if (node.inputs) {
      for (const inputId of node.inputs) {
        const inputNode = nodes.find(n => n.id === inputId);
        if (inputNode) {
          visit(inputNode);
        }
      }
    }

    visiting.delete(node.id);
    visited.add(node.id);
    sorted.push(node);
  };

  for (const node of nodes) {
    if (!visited.has(node.id)) {
      visit(node);
    }
  }

  return sorted;
}
