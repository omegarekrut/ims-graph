import type {
  GraphDependency,
  GraphId,
  GraphInputBinding,
  GraphKind,
  GraphOptions,
  GraphOutputBinding,
  SceneDerivedValueDefinition,
  SceneId,
  SceneSharedStore
} from '../core/contracts';
import {
  applyGraphStoreInputs,
  normalizeGraphOptionsForKind,
  normalizeGraphInputBindings,
  normalizeGraphOutputBindings
} from './graph-adapters';

export interface ResolvedGraphDefinition {
  graphId: GraphId;
  kind: GraphKind;
  mount: Element;
  options: GraphOptions;
  inputs: GraphInputBinding[];
  outputs: GraphOutputBinding[];
  dependsOn: GraphDependency[];
}

export interface ResolvedSceneDefinition {
  sceneId: SceneId;
  mount: Element;
  graphs: ResolvedGraphDefinition[];
  sharedState: Record<string, unknown>;
  derivedState: SceneDerivedValueDefinition[];
}

export function normalizeGraphInputs(
  kind: GraphKind,
  inputs: GraphInputBinding[] | undefined
): GraphInputBinding[] {
  if (!inputs || !inputs.length) {
    return [];
  }

  const normalized: GraphInputBinding[] = [];
  inputs.forEach((entry) => {
    if (!entry || typeof entry.optionKey !== 'string') {
      return;
    }
    if (typeof entry.storeKey !== 'string') {
      return;
    }

    const optionKey = entry.optionKey.trim();
    if (optionKey === '') {
      return;
    }

    const storeKey = entry.storeKey.trim();
    if (storeKey === '') {
      return;
    }

    normalized.push({
      optionKey,
      storeKey
    });
  });

  return normalizeGraphInputBindings(kind, normalized);
}

export function normalizeGraphOutputs(
  kind: GraphKind,
  outputs: GraphOutputBinding[] | undefined
): GraphOutputBinding[] {
  if (!outputs || !outputs.length) {
    return [];
  }

  const normalized: GraphOutputBinding[] = [];
  outputs.forEach((entry) => {
    if (!entry || typeof entry.outputKey !== 'string') {
      return;
    }

    const outputKey = entry.outputKey.trim();
    if (outputKey === '') {
      return;
    }

    const event = entry.event === 'graph:output' ? entry.event : 'graph:output';
    const storeKey = typeof entry.storeKey === 'string' && entry.storeKey.trim() !== ''
      ? entry.storeKey.trim()
      : undefined;

    normalized.push({
      outputKey,
      storeKey,
      event
    });
  });

  return normalizeGraphOutputBindings(kind, normalized);
}

export function normalizeGraphDependencies(dependsOn: GraphDependency[] | undefined): GraphDependency[] {
  if (!dependsOn || !dependsOn.length) {
    return [];
  }

  return dependsOn.filter((entry) => {
    if (!entry || typeof entry.source !== 'object' || entry.source === null) {
      return false;
    }
    const hasGraphId = typeof entry.source.graphId === 'string' && entry.source.graphId.trim() !== '';
    const hasSelector = typeof entry.source.selector === 'string' && entry.source.selector.trim() !== '';
    return hasGraphId || hasSelector;
  }).map((entry) => ({
    source: {
      graphId: typeof entry.source.graphId === 'string' && entry.source.graphId.trim() !== ''
        ? entry.source.graphId.trim()
        : undefined,
      selector: typeof entry.source.selector === 'string' && entry.source.selector.trim() !== ''
        ? entry.source.selector.trim()
        : undefined
    },
    event: entry.event || 'graph:ready',
    outputKey: entry.outputKey
  }));
}

export function normalizeSharedState(value: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!value || typeof value !== 'object') {
    return {};
  }
  return { ...value };
}

export function normalizeDerivedState(value: SceneDerivedValueDefinition[] | undefined): SceneDerivedValueDefinition[] {
  if (!value || !value.length) {
    return [];
  }

  const normalized: SceneDerivedValueDefinition[] = [];
  value.forEach((entry) => {
    if (!entry || typeof entry.key !== 'string') {
      return;
    }

    const key = entry.key.trim();
    if (key === '') {
      return;
    }

    if (!Array.isArray(entry.dependsOn) || !entry.dependsOn.length) {
      return;
    }

    if (typeof entry.derive !== 'function') {
      return;
    }

    normalized.push({
      key,
      dependsOn: entry.dependsOn,
      derive: entry.derive
    });
  });

  return normalized;
}

export function shallowEqualGraphOptions(left: GraphOptions, right: GraphOptions): boolean {
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const keys = new Set<string>([
    ...Object.keys(leftRecord),
    ...Object.keys(rightRecord)
  ]);

  for (const key of keys) {
    if (leftRecord[key] !== rightRecord[key]) {
      return false;
    }
  }

  return true;
}

export function shallowEqualGraphInputs(left: GraphInputBinding[], right: GraphInputBinding[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((entry, index) => {
    const rightEntry = right[index];
    if (!rightEntry) {
      return false;
    }
    return entry.optionKey === rightEntry.optionKey && entry.storeKey === rightEntry.storeKey;
  });
}

export function shallowEqualGraphOutputs(left: GraphOutputBinding[], right: GraphOutputBinding[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((entry, index) => {
    const rightEntry = right[index];
    if (!rightEntry) {
      return false;
    }
    return entry.outputKey === rightEntry.outputKey &&
      entry.storeKey === rightEntry.storeKey &&
      (entry.event || 'graph:output') === (rightEntry.event || 'graph:output');
  });
}

export function shallowEqualGraphDependencies(left: GraphDependency[], right: GraphDependency[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((entry, index) => {
    const rightEntry = right[index];
    if (!rightEntry) {
      return false;
    }
    return entry.source.graphId === rightEntry.source.graphId &&
      entry.source.selector === rightEntry.source.selector &&
      (entry.event || 'graph:ready') === (rightEntry.event || 'graph:ready') &&
      entry.outputKey === rightEntry.outputKey;
  });
}

export function mergeGraphOptions(current: GraphOptions, patch: GraphOptions | undefined): GraphOptions {
  if (!patch) {
    return current;
  }
  return {
    ...current,
    ...patch
  };
}

export function withStoreInputs(
  definition: ResolvedGraphDefinition,
  store: SceneSharedStore | null
): ResolvedGraphDefinition {
  if (!store || !definition.inputs.length) {
    return definition;
  }

  const nextOptions = applyGraphStoreInputs(
    definition.kind,
    definition.options,
    definition.inputs,
    store
  );
  const normalizedOptions = normalizeGraphOptionsForKind(definition.kind, nextOptions);

  if (shallowEqualGraphOptions(definition.options, normalizedOptions)) {
    return definition;
  }

  return {
    ...definition,
    options: normalizedOptions
  };
}

export function shouldEnableOrchestration(definition: ResolvedSceneDefinition): boolean {
  const hasSharedState = Object.keys(definition.sharedState).length > 0;
  const hasDerivedState = definition.derivedState.length > 0;
  const hasGraphBindings = definition.graphs.some((graph) => {
    return graph.inputs.length > 0 || graph.outputs.length > 0 || graph.dependsOn.length > 0;
  });

  return hasSharedState || hasDerivedState || hasGraphBindings;
}
