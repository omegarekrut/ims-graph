import type {
  GraphId,
  GraphInstance,
  LegacyGrowthCalculatorApi,
  SceneGraphEvent,
  SceneId,
  SceneInstance,
  SceneSharedStore,
} from '../core/contracts';
import { readGraphOutputValue } from './graph-adapters';
import {
  createDependencyIndex,
  createStoreInputIndex,
  orderSceneGraphsByDependencies,
} from './scene-dependency-graph';
import { SceneEventBus } from './scene-events';
import type { ResolvedGraphDefinition, ResolvedSceneDefinition } from './scene-normalization';
import { withStoreInputs } from './scene-normalization';
import { InMemorySceneStore } from './scene-store';

export interface SceneOrchestrationContext {
  mountResolvedGraph: (
    definition: ResolvedGraphDefinition,
    sceneId: SceneId | null,
    legacyApi: LegacyGrowthCalculatorApi | null,
    reuseExisting: boolean
  ) => GraphInstance | null;
  setSceneCleanup: (sceneId: SceneId, cleanup: () => void) => void;
}

function publishSceneEvent(eventBus: SceneEventBus, event: SceneGraphEvent): void {
  eventBus.publish(event);
}

function publishGraphReady(sceneId: SceneId, graph: GraphInstance, eventBus: SceneEventBus): void {
  publishSceneEvent(eventBus, {
    type: 'graph:ready',
    sceneId,
    graphId: graph.graphId,
    source: { graphId: graph.graphId },
    timestampMs: Date.now(),
  });
}

function publishGraphOutputs(
  sceneId: SceneId,
  graph: GraphInstance,
  eventBus: SceneEventBus,
  store: SceneSharedStore | null
): void {
  graph.outputs.forEach((output) => {
    const outputKey = String(output.outputKey);
    const value = readGraphOutputValue(graph, outputKey);

    if (store && output.storeKey) {
      store.set(output.storeKey, value, graph.graphId);
    }

    publishSceneEvent(eventBus, {
      type: output.event || 'graph:output',
      sceneId,
      graphId: graph.graphId,
      outputKey,
      storeKey: output.storeKey,
      source: { graphId: graph.graphId },
      value,
      timestampMs: Date.now(),
    });
  });
}

export function initSceneWithOrchestration(
  definition: ResolvedSceneDefinition,
  legacyApi: LegacyGrowthCalculatorApi | null,
  context: SceneOrchestrationContext
): SceneInstance {
  const eventBus = new SceneEventBus();
  const store = new InMemorySceneStore(definition.sharedState, definition.derivedState);
  const orderedGraphs = orderSceneGraphsByDependencies(definition.graphs);
  const dependencyIndex = createDependencyIndex(definition.graphs);
  const storeInputIndex = createStoreInputIndex(definition.graphs);
  const graphDefinitionById = new Map<GraphId, ResolvedGraphDefinition>();
  const graphInstanceById = new Map<GraphId, GraphInstance>();
  const sceneInstance: SceneInstance = {
    sceneId: definition.sceneId,
    mount: definition.mount,
    graphs: [],
    store,
    orchestrationEnabled: true,
    createdAtMs: Date.now(),
  };

  definition.graphs.forEach((graphDefinition) => {
    graphDefinitionById.set(graphDefinition.graphId, graphDefinition);
  });

  const upsertSceneGraph = (graphId: GraphId, graph: GraphInstance): void => {
    const existingIndex = sceneInstance.graphs.findIndex((entry) => entry.graphId === graphId);
    if (existingIndex >= 0) {
      sceneInstance.graphs[existingIndex] = graph;
      return;
    }

    const definitionIndex = definition.graphs.findIndex((entry) => entry.graphId === graphId);
    if (definitionIndex < 0) {
      sceneInstance.graphs.push(graph);
      return;
    }

    sceneInstance.graphs.splice(definitionIndex, 0, graph);
  };

  const remountGraph = (
    targetGraphId: GraphId,
    sourceGraphId: GraphId | null,
    triggerOutputKey?: string
  ): void => {
    const targetDefinition = graphDefinitionById.get(targetGraphId);
    if (!targetDefinition) {
      return;
    }

    const previous = graphInstanceById.get(targetGraphId) || null;
    const mergedDefinition = withStoreInputs(targetDefinition, store);
    const mounted = context.mountResolvedGraph(
      mergedDefinition,
      definition.sceneId,
      legacyApi,
      true
    );

    if (!mounted) {
      return;
    }

    graphInstanceById.set(targetGraphId, mounted);
    upsertSceneGraph(targetGraphId, mounted);
    if (previous === mounted) {
      return;
    }

    publishSceneEvent(eventBus, {
      type: 'graph:input-applied',
      sceneId: definition.sceneId,
      graphId: mounted.graphId,
      outputKey: triggerOutputKey,
      source: sourceGraphId ? { graphId: sourceGraphId } : undefined,
      timestampMs: Date.now(),
    });
    publishGraphOutputs(definition.sceneId, mounted, eventBus, store);
  };

  orderedGraphs.forEach((graphDefinition) => {
    const mergedDefinition = withStoreInputs(graphDefinition, store);
    const graph = context.mountResolvedGraph(mergedDefinition, definition.sceneId, legacyApi, true);

    if (!graph) {
      return;
    }

    graphInstanceById.set(graph.graphId, graph);
    upsertSceneGraph(graph.graphId, graph);
    publishGraphReady(definition.sceneId, graph, eventBus);
    publishGraphOutputs(definition.sceneId, graph, eventBus, store);
  });

  const unsubscribeOutput = eventBus.subscribe({ type: 'graph:output' }, (event) => {
    if (!event.graphId) {
      return;
    }

    const links = dependencyIndex.get(event.graphId) || [];
    links.forEach((link) => {
      if (link.event !== 'graph:output') {
        return;
      }
      if (link.outputKey && link.outputKey !== event.outputKey) {
        return;
      }
      remountGraph(link.targetGraphId, event.graphId, event.outputKey);
    });
  });

  const unsubscribeReady = eventBus.subscribe({ type: 'graph:ready' }, (event) => {
    if (!event.graphId) {
      return;
    }

    const links = dependencyIndex.get(event.graphId) || [];
    links.forEach((link) => {
      if (link.event !== 'graph:ready') {
        return;
      }
      remountGraph(link.targetGraphId, event.graphId, event.outputKey);
    });
  });

  const unsubscribeStore = store.subscribe((storeEvent) => {
    publishSceneEvent(eventBus, {
      type: 'store:updated',
      sceneId: definition.sceneId,
      graphId: storeEvent.sourceGraphId,
      storeKey: storeEvent.key,
      value: storeEvent.value,
      source: storeEvent.sourceGraphId ? { graphId: storeEvent.sourceGraphId } : undefined,
      timestampMs: Date.now(),
    });

    const targets = storeInputIndex.get(storeEvent.key);
    if (!targets) {
      return;
    }

    targets.forEach((graphId) => {
      if (storeEvent.sourceGraphId && storeEvent.sourceGraphId === graphId) {
        return;
      }
      remountGraph(graphId, storeEvent.sourceGraphId, storeEvent.key);
    });
  });

  publishSceneEvent(eventBus, {
    type: 'scene:ready',
    sceneId: definition.sceneId,
    graphId: null,
    timestampMs: Date.now(),
  });

  context.setSceneCleanup(definition.sceneId, () => {
    unsubscribeOutput();
    unsubscribeReady();
    unsubscribeStore();
  });

  return sceneInstance;
}

export function initSceneWithoutOrchestration(
  definition: ResolvedSceneDefinition,
  legacyApi: LegacyGrowthCalculatorApi | null,
  context: SceneOrchestrationContext
): SceneInstance {
  const graphs: GraphInstance[] = [];

  definition.graphs.forEach((graphDefinition) => {
    const graph = context.mountResolvedGraph(graphDefinition, definition.sceneId, legacyApi, true);
    graph && graphs.push(graph);
  });

  return {
    sceneId: definition.sceneId,
    mount: definition.mount,
    graphs,
    store: null,
    orchestrationEnabled: false,
    createdAtMs: Date.now(),
  };
}
