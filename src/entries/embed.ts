import type {
  GraphMountTarget,
  ImsGrowthCalculatorPublicApi,
  LegacyGrowthCalculatorApi,
  SceneDefinition,
  SceneInstance
} from '../core/contracts';
import type { GraphInstance, GrowthCalculatorOptions } from '../core/contracts';
import {
  autoInitGraphs,
  autoInitScenes,
  initGraph,
  initScene as initRuntimeScene
} from '../scenes/runtime';
import {
  normalizeLegacyOptions,
  normalizeLegacyTarget
} from '../widgets/legacy-bridge';

let runtimeLegacyApi: LegacyGrowthCalculatorApi | null = null;

function graphToLegacyInstance(graph: GraphInstance | null): unknown | null {
  if (!graph) {
    return null;
  }
  return graph.legacyInstance;
}

function graphsToLegacyInstances(graphs: GraphInstance[]): unknown[] {
  return graphs
    .map((graph) => graph.legacyInstance)
    .filter((instance) => instance !== null);
}

function collectUniqueGraphInstances(scenes: SceneInstance[], graphs: GraphInstance[]): GraphInstance[] {
  const sceneGraphs = scenes.flatMap((scene) => scene.graphs);
  const byMount = new Map<Element, GraphInstance>();

  [...sceneGraphs, ...graphs].forEach((graph) => {
    byMount.set(graph.mount, graph);
  });

  return Array.from(byMount.values());
}

export function setRuntimeLegacyApi(api: LegacyGrowthCalculatorApi | null): void {
  runtimeLegacyApi = api;
}

export function loadLegacyRuntime(): LegacyGrowthCalculatorApi | null {
  return runtimeLegacyApi;
}

export function initEmbed(target: GraphMountTarget, options: GrowthCalculatorOptions = {}): unknown | null {
  const normalizedTarget = normalizeLegacyTarget(target);
  if (!normalizedTarget) {
    return null;
  }
  const normalizedOptions = normalizeLegacyOptions(options);
  const graph = initGraph(normalizedTarget, normalizedOptions, runtimeLegacyApi);
  return graphToLegacyInstance(graph);
}

export function autoInitEmbed(root: ParentNode = document): unknown[] {
  const scenes = autoInitScenes(root, runtimeLegacyApi);
  const graphs = autoInitGraphs(root, runtimeLegacyApi);
  const uniqueGraphs = collectUniqueGraphInstances(scenes, graphs);
  return graphsToLegacyInstances(uniqueGraphs);
}

export function initScene(scene: SceneDefinition | GraphMountTarget): SceneInstance | null {
  return initRuntimeScene(scene, runtimeLegacyApi);
}

export function autoInitScene(root: ParentNode = document): SceneInstance[] {
  return autoInitScenes(root, runtimeLegacyApi);
}

export function initSceneEmbed(scene: SceneDefinition | GraphMountTarget): SceneInstance | null {
  return initScene(scene);
}

export function autoInitSceneEmbed(root: ParentNode = document): SceneInstance[] {
  return autoInitScene(root);
}

export const publicApi: ImsGrowthCalculatorPublicApi = {
  init: initEmbed,
  autoInit: autoInitEmbed,
  initScene: initScene,
  autoInitScene: autoInitScene
};
