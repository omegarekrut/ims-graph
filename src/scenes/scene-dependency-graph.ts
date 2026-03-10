import type {
  GraphDependency,
  GraphId
} from '../core/contracts';
import { toGraphId } from '../shared/ids';
import type { ResolvedGraphDefinition } from './scene-normalization';

export interface DependencyLink {
  sourceGraphId: GraphId;
  targetGraphId: GraphId;
  event: 'graph:ready' | 'graph:output';
  outputKey?: string;
}

function resolveDependencySourceIds(
  dependency: GraphDependency,
  graphs: ResolvedGraphDefinition[]
): GraphId[] {
  const graphId = toGraphId(dependency.source.graphId);
  if (graphId) {
    return graphs.some((graph) => graph.graphId === graphId) ? [graphId] : [];
  }

  const selector = dependency.source.selector;
  if (!selector) {
    return [];
  }

  return graphs
    .filter((graph) => graph.mount.matches(selector))
    .map((graph) => graph.graphId);
}

export function orderSceneGraphsByDependencies(
  graphs: ResolvedGraphDefinition[]
): ResolvedGraphDefinition[] {
  const byId = new Map<GraphId, ResolvedGraphDefinition>();
  const inDegree = new Map<GraphId, number>();
  const edges = new Map<GraphId, Set<GraphId>>();

  graphs.forEach((graph) => {
    byId.set(graph.graphId, graph);
    inDegree.set(graph.graphId, 0);
    edges.set(graph.graphId, new Set<GraphId>());
  });

  graphs.forEach((targetGraph) => {
    targetGraph.dependsOn.forEach((dependency) => {
      const sourceGraphIds = resolveDependencySourceIds(dependency, graphs);
      sourceGraphIds.forEach((sourceGraphId) => {
        if (sourceGraphId === targetGraph.graphId) {
          return;
        }

        const neighbors = edges.get(sourceGraphId);
        if (!neighbors || neighbors.has(targetGraph.graphId)) {
          return;
        }

        neighbors.add(targetGraph.graphId);
        inDegree.set(targetGraph.graphId, (inDegree.get(targetGraph.graphId) || 0) + 1);
      });
    });
  });

  const queue: GraphId[] = graphs
    .map((graph) => graph.graphId)
    .filter((graphId) => (inDegree.get(graphId) || 0) === 0);
  const ordered: ResolvedGraphDefinition[] = [];
  const visited = new Set<GraphId>();

  while (queue.length) {
    const graphId = queue.shift() as GraphId;
    if (visited.has(graphId)) {
      continue;
    }
    visited.add(graphId);
    byId.get(graphId) && ordered.push(byId.get(graphId) as ResolvedGraphDefinition);

    const neighbors = edges.get(graphId);
    if (!neighbors) {
      continue;
    }

    neighbors.forEach((neighborGraphId) => {
      const nextDegree = (inDegree.get(neighborGraphId) || 0) - 1;
      inDegree.set(neighborGraphId, nextDegree);
      if (nextDegree === 0) {
        queue.push(neighborGraphId);
      }
    });
  }

  const unresolved = graphs.filter((graph) => !visited.has(graph.graphId));
  return [...ordered, ...unresolved];
}

export function createDependencyIndex(
  graphs: ResolvedGraphDefinition[]
): Map<GraphId, DependencyLink[]> {
  const index = new Map<GraphId, DependencyLink[]>();

  graphs.forEach((targetGraph) => {
    targetGraph.dependsOn.forEach((dependency) => {
      const sourceGraphIds = resolveDependencySourceIds(dependency, graphs);
      const dependencyEvent = dependency.event || 'graph:ready';

      sourceGraphIds.forEach((sourceGraphId) => {
        const links = index.get(sourceGraphId) || [];
        links.push({
          sourceGraphId,
          targetGraphId: targetGraph.graphId,
          event: dependencyEvent,
          outputKey: dependency.outputKey
        });
        index.set(sourceGraphId, links);
      });
    });
  });

  return index;
}

export function createStoreInputIndex(
  graphs: ResolvedGraphDefinition[]
): Map<string, Set<GraphId>> {
  const index = new Map<string, Set<GraphId>>();

  graphs.forEach((graph) => {
    graph.inputs.forEach((binding) => {
      const targets = index.get(binding.storeKey) || new Set<GraphId>();
      targets.add(graph.graphId);
      index.set(binding.storeKey, targets);
    });
  });

  return index;
}
