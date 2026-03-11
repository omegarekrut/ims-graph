import type {
  GraphDefinition,
  GraphId,
  GraphInstance,
  GraphMountTarget,
  LegacyGrowthCalculatorApi,
  SceneDefinition,
  SceneId,
  SceneInstance,
  SceneMountTarget,
} from '../core/contracts';
import { DEFAULT_GRAPH_KIND, DEFAULT_GRAPH_SELECTOR } from '../core/defaults';
import { readGrowthOptionsFromElement } from '../core/options';
import {
  discoverGraphMounts,
  discoverSceneMounts,
  isElementInContainer,
  resolveElement,
  uniqueElements,
} from '../shared/dom';
import { createGraphId, createSceneId, toGraphId, toSceneId } from '../shared/ids';
import { resetPageLeadGateController } from '../widgets/lead/lead-gate';
import {
  mountGraphWithAdapter,
  normalizeGraphOptionsForKind,
  resetGraphAdapters,
} from './graph-adapters';
import type { InMemoryGraphRegistry } from './graph-registry';
import {
  mergeGraphOptions,
  normalizeDerivedState,
  normalizeGraphDependencies,
  normalizeGraphInputs,
  normalizeGraphOutputs,
  normalizeSharedState,
  type ResolvedGraphDefinition,
  type ResolvedSceneDefinition,
  shallowEqualGraphDependencies,
  shallowEqualGraphInputs,
  shallowEqualGraphOptions,
  shallowEqualGraphOutputs,
  shouldEnableOrchestration,
} from './scene-normalization';
import {
  initSceneWithOrchestration,
  initSceneWithoutOrchestration,
  type SceneOrchestrationContext,
} from './scene-orchestrator';
import {
  getGraphRuntimeRegistry,
  getSceneById,
  getSceneByMount,
  listScenes,
  registerScene,
  resetSceneRuntimeState,
  setSceneCleanup,
} from './scene-registry';

const graphRegistry = getGraphRuntimeRegistry();

function normalizeIdPrefix(value: string): string {
  const normalized = value.replace(/[^a-zA-Z0-9-_]+/g, '-').replace(/-+/g, '-');
  return normalized === '' ? 'ims-graph' : normalized;
}

function normalizeSceneIdPrefix(value: string): string {
  const normalized = value.replace(/[^a-zA-Z0-9-_]+/g, '-').replace(/-+/g, '-');
  return normalized === '' ? 'ims-scene' : normalized;
}

function ensureUniqueGraphId(preferred: GraphId, mount: Element): GraphId {
  const existing = graphRegistry.getById(preferred);
  if (!existing) {
    return preferred;
  }
  if (existing.mount === mount) {
    return preferred;
  }
  return createGraphId(normalizeIdPrefix(preferred));
}

function deriveGraphIdFromMount(mount: Element): GraphId {
  const byAttr = toGraphId(mount.getAttribute('data-ims-graph'));
  if (byAttr) {
    return ensureUniqueGraphId(byAttr, mount);
  }

  const byElementId = toGraphId(mount.id);
  if (byElementId) {
    return ensureUniqueGraphId(byElementId, mount);
  }

  return createGraphId();
}

function ensureUniqueSceneId(preferred: SceneId, mount: Element): SceneId {
  const existing = getSceneById(preferred);
  if (!existing) {
    return preferred;
  }
  if (existing.mount === mount) {
    return preferred;
  }
  return createSceneId(normalizeSceneIdPrefix(preferred));
}

function normalizeGraphDefinition(
  definition: GraphDefinition,
  root: ParentNode
): ResolvedGraphDefinition | null {
  const mount = resolveElement(definition.mount, root);
  if (!mount) {
    return null;
  }

  const kind = definition.kind || DEFAULT_GRAPH_KIND;
  const preferredGraphId = toGraphId(definition.graphId as string | null | undefined);
  return {
    graphId: preferredGraphId
      ? ensureUniqueGraphId(preferredGraphId, mount)
      : deriveGraphIdFromMount(mount),
    kind,
    mount,
    options: normalizeGraphOptionsForKind(kind, definition.options),
    inputs: normalizeGraphInputs(kind, definition.inputs),
    outputs: normalizeGraphOutputs(kind, definition.outputs),
    dependsOn: normalizeGraphDependencies(definition.dependsOn),
  };
}

function buildGraphDefinitionFromMount(mount: Element): GraphDefinition {
  return {
    graphId: deriveGraphIdFromMount(mount),
    kind: DEFAULT_GRAPH_KIND,
    mount,
    options: readGrowthOptionsFromElement(mount),
    inputs: [],
    outputs: [],
    dependsOn: [],
  };
}

function resolveSceneMount(target: SceneMountTarget, root: ParentNode): Element | null {
  return resolveElement(target, root);
}

function nearestSceneMount(mount: Element): Element | null {
  return mount.closest('[data-ims-scene]');
}

function hasSceneMarker(mount: Element): boolean {
  return mount.hasAttribute('data-ims-scene');
}

function isLegacyDefaultMount(mount: Element): boolean {
  return mount.matches(DEFAULT_GRAPH_SELECTOR);
}

function isElementTarget(value: unknown): value is Element {
  return typeof Element !== 'undefined' && value instanceof Element;
}

function isOwnedByScene(sceneMount: Element, graphMount: Element): boolean {
  return nearestSceneMount(graphMount) === sceneMount;
}

function graphMountsWithinScene(sceneMount: Element): Element[] {
  const discovered = discoverGraphMounts(sceneMount).filter((mount) =>
    isOwnedByScene(sceneMount, mount)
  );
  const includeSceneMount =
    (isLegacyDefaultMount(sceneMount) || sceneMount.hasAttribute('data-ims-graph')) &&
    isOwnedByScene(sceneMount, sceneMount);
  if (!includeSceneMount) {
    return discovered;
  }
  return uniqueElements([sceneMount, ...discovered]);
}

function definitionFromSceneInput(
  scene: SceneDefinition,
  root: ParentNode
): ResolvedSceneDefinition | null {
  const mount = resolveSceneMount(scene.mount, root);
  if (!mount) {
    return null;
  }

  const explicitSceneId = toSceneId(scene.sceneId || mount.getAttribute('data-ims-scene'));
  const sceneId = ensureUniqueSceneId(explicitSceneId || createSceneId(), mount);
  mount.setAttribute('data-ims-scene', sceneId);

  const explicitGraphs = scene.graphs || [];
  const rawDefinitions = explicitGraphs.length
    ? explicitGraphs
    : graphMountsWithinScene(mount).map(buildGraphDefinitionFromMount);
  const graphs = rawDefinitions
    .map((definition) => normalizeGraphDefinition(definition, mount))
    .filter((definition): definition is ResolvedGraphDefinition => definition !== null);

  return {
    sceneId,
    mount,
    graphs,
    sharedState: normalizeSharedState(scene.sharedState),
    derivedState: normalizeDerivedState(scene.derivedState),
  };
}

function mountResolvedGraph(
  definition: ResolvedGraphDefinition,
  sceneId: SceneId | null,
  legacyApi: LegacyGrowthCalculatorApi | null,
  reuseExisting: boolean
): GraphInstance | null {
  const existing = graphRegistry.getByMount(definition.mount);
  if (reuseExisting && existing) {
    const nextGraphId = definition.graphId || existing.graphId;
    const nextOptions = mergeGraphOptions(existing.options, definition.options);
    const nextSceneId = sceneId;
    const nextKind = definition.kind || existing.kind;
    const hasGraphIdUpdate = existing.graphId !== nextGraphId;
    const hasSceneUpdate = existing.sceneId !== nextSceneId;
    const hasKindUpdate = existing.kind !== nextKind;
    const hasOptionsUpdate = !shallowEqualGraphOptions(existing.options, nextOptions);
    const hasInputUpdate = !shallowEqualGraphInputs(existing.inputs, definition.inputs);
    const hasOutputUpdate = !shallowEqualGraphOutputs(existing.outputs, definition.outputs);
    const hasDependencyUpdate = !shallowEqualGraphDependencies(
      existing.dependsOn,
      definition.dependsOn
    );

    if (
      !hasGraphIdUpdate &&
      !hasSceneUpdate &&
      !hasKindUpdate &&
      !hasOptionsUpdate &&
      !hasInputUpdate &&
      !hasOutputUpdate &&
      !hasDependencyUpdate
    ) {
      return existing;
    }

    const remounted = mountGraphWithAdapter({
      graphId: nextGraphId,
      kind: nextKind,
      mount: existing.mount,
      options: nextOptions,
      sceneId: nextSceneId,
      legacyApi,
      definition,
    });

    if (!remounted) {
      return null;
    }

    return graphRegistry.register(remounted);
  }

  const mounted = mountGraphWithAdapter({
    graphId: definition.graphId,
    kind: definition.kind,
    mount: definition.mount,
    options: definition.options,
    sceneId,
    legacyApi,
    definition,
  });

  if (!mounted) {
    return null;
  }

  return graphRegistry.register(mounted);
}

const sceneOrchestrationContext: SceneOrchestrationContext = {
  mountResolvedGraph,
  setSceneCleanup,
};

function initGraphDefinition(
  definition: GraphDefinition,
  root: ParentNode,
  sceneId: SceneId | null,
  legacyApi: LegacyGrowthCalculatorApi | null,
  reuseExisting: boolean
): GraphInstance | null {
  const normalized = normalizeGraphDefinition(definition, root);
  if (!normalized) {
    return null;
  }

  return mountResolvedGraph(normalized, sceneId, legacyApi, reuseExisting);
}

export function getGraphRegistry(): InMemoryGraphRegistry {
  return graphRegistry;
}

export function getSceneRegistry(): SceneInstance[] {
  return listScenes();
}

export function initGraph(
  target: GraphMountTarget,
  options: GraphDefinition['options'] = {},
  legacyApi: LegacyGrowthCalculatorApi | null = null
): GraphInstance | null {
  return initGraphDefinition(
    {
      mount: target,
      options,
      kind: DEFAULT_GRAPH_KIND,
      inputs: [],
      outputs: [],
      dependsOn: [],
    },
    document,
    null,
    legacyApi,
    false
  );
}

export function autoInitGraphs(
  root: ParentNode = document,
  legacyApi: LegacyGrowthCalculatorApi | null = null
): GraphInstance[] {
  const mounts = discoverGraphMounts(root);
  if (!mounts.length) {
    return [];
  }

  const sceneMounts = discoverSceneMounts(root);
  const initialized: GraphInstance[] = [];

  mounts.forEach((mount) => {
    const hasAncestorScene = sceneMounts.some((sceneMount) => {
      return isElementInContainer(mount, sceneMount) && hasSceneMarker(sceneMount);
    });
    if (hasAncestorScene) {
      return;
    }

    const graph = initGraphDefinition(
      buildGraphDefinitionFromMount(mount),
      root,
      null,
      legacyApi,
      true
    );
    graph && initialized.push(graph);
  });

  return initialized;
}

export function initScene(
  scene: SceneDefinition | SceneMountTarget,
  legacyApi: LegacyGrowthCalculatorApi | null = null
): SceneInstance | null {
  if (scene === null) {
    return null;
  }

  const definition =
    typeof scene === 'object' && !isElementTarget(scene)
      ? definitionFromSceneInput(scene as SceneDefinition, document)
      : definitionFromSceneInput({ mount: scene as SceneMountTarget }, document);
  if (!definition) {
    return null;
  }

  const existingByMount = getSceneByMount(definition.mount);
  if (existingByMount) {
    return existingByMount;
  }

  const existingById = getSceneById(definition.sceneId);
  if (existingById) {
    return existingById;
  }

  const orchestrationEnabled = shouldEnableOrchestration(definition);
  const sceneInstance = orchestrationEnabled
    ? initSceneWithOrchestration(definition, legacyApi, sceneOrchestrationContext)
    : initSceneWithoutOrchestration(definition, legacyApi, sceneOrchestrationContext);

  registerScene(sceneInstance);
  return sceneInstance;
}

export function autoInitScenes(
  root: ParentNode = document,
  legacyApi: LegacyGrowthCalculatorApi | null = null
): SceneInstance[] {
  const sceneMounts = discoverSceneMounts(root);
  if (!sceneMounts.length) {
    return [];
  }

  const initialized: SceneInstance[] = [];

  sceneMounts.forEach((sceneMount) => {
    const sceneInstance = initScene({ mount: sceneMount }, legacyApi);
    sceneInstance && initialized.push(sceneInstance);
  });

  return initialized;
}

export function resetRuntimeRegistry(): void {
  resetSceneRuntimeState(resetGraphAdapters);
  resetPageLeadGateController();
}
