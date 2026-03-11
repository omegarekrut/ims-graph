import type {
  GraphInstance,
  GraphMountTarget,
  ImsGrowthCalculatorPublicApi,
  LegacyGrowthCalculatorApi,
  GrowthCalculatorOptions
} from '../core/contracts';
import {
  autoInitGraphs,
  initGraph
} from '../scenes/runtime';
import {
  normalizeLegacyOptions,
  normalizeLegacyTarget
} from '../widgets/legacy-bridge';
import { getLegacyApi } from '../widgets/legacy-api';
import {
  autoInitScene,
  initScene,
  setRuntimeLegacyApi
} from './embed';

interface SingleGraphBootstrapOptions {
  autoInit?: boolean;
  force?: boolean;
}

type RuntimeWindow = Window & {
  __IMS_GRAPH_SINGLE_RUNTIME_BOOTSTRAPPED__?: boolean;
  ImsGrowthCalculator?: ImsGrowthCalculatorPublicApi;
};

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

let runtimeLegacyApi: LegacyGrowthCalculatorApi | null = null;

export function setSingleGraphLegacyApi(api: LegacyGrowthCalculatorApi | null): void {
  runtimeLegacyApi = api;
  setRuntimeLegacyApi(api);
}

export function loadSingleGraphLegacyRuntime(): LegacyGrowthCalculatorApi | null {
  return runtimeLegacyApi;
}

export function initSingleGraphEmbed(
  target: GraphMountTarget,
  options: GrowthCalculatorOptions = {}
): unknown | null {
  const normalizedTarget = normalizeLegacyTarget(target);
  if (!normalizedTarget) {
    return null;
  }
  const normalizedOptions = normalizeLegacyOptions(options);
  const graph = initGraph(normalizedTarget, normalizedOptions, runtimeLegacyApi);
  return graphToLegacyInstance(graph);
}

export function autoInitSingleGraphEmbed(root: ParentNode = document): unknown[] {
  const graphs = autoInitGraphs(root, runtimeLegacyApi);
  return graphsToLegacyInstances(graphs);
}

export const singleGraphPublicApi: ImsGrowthCalculatorPublicApi = {
  init: initSingleGraphEmbed,
  autoInit: autoInitSingleGraphEmbed,
  initScene,
  autoInitScene
};

function scheduleAutoInit(): void {
  if (typeof document === 'undefined') {
    return;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      autoInitSingleGraphEmbed();
    });
    return;
  }

  autoInitSingleGraphEmbed();
}

export function installSingleGraphRuntime(
  options: SingleGraphBootstrapOptions = {}
): ImsGrowthCalculatorPublicApi {
  if (typeof window === 'undefined') {
    return singleGraphPublicApi;
  }
  const runtimeWindow = window as RuntimeWindow;

  const shouldForce = options.force === true;
  const alreadyBootstrapped = runtimeWindow.__IMS_GRAPH_SINGLE_RUNTIME_BOOTSTRAPPED__ === true;
  if (!shouldForce && alreadyBootstrapped) {
    return singleGraphPublicApi;
  }

  setSingleGraphLegacyApi(getLegacyApi());
  runtimeWindow.ImsGrowthCalculator = singleGraphPublicApi;
  runtimeWindow.__IMS_GRAPH_SINGLE_RUNTIME_BOOTSTRAPPED__ = true;

  const shouldAutoInit = options.autoInit !== false;
  if (shouldAutoInit) {
    scheduleAutoInit();
  }

  return singleGraphPublicApi;
}

installSingleGraphRuntime();
