import type {
  GraphDefinition,
  GraphId,
  GraphInputBinding,
  GraphInstance,
  GraphKind,
  GraphOptions,
  GraphOutputBinding,
  GrowthCalculatorOptions,
  LegacyGrowthCalculatorApi,
  SceneId,
  SceneSharedStore
} from '../core/contracts';
import { normalizeGrowthOptions } from '../core/options';
import { mountGrowthWidget } from '../widgets/growth-widget';

export interface GraphAdapterMountArgs {
  graphId: GraphId;
  kind: GraphKind;
  mount: Element;
  options: GraphOptions;
  sceneId: SceneId | null;
  legacyApi: LegacyGrowthCalculatorApi | null;
  definition: GraphDefinition;
}

export interface GraphAdapter {
  kind: GraphKind;
  normalizeOptions?(options: GraphOptions | undefined): GraphOptions;
  mount(args: GraphAdapterMountArgs): GraphInstance;
  readOutput(instance: GraphInstance, outputKey: string): unknown;
  normalizeInputs?(inputs: GraphInputBinding[]): GraphInputBinding[];
  normalizeOutputs?(outputs: GraphOutputBinding[]): GraphOutputBinding[];
  applyStoreInputs?(options: GraphOptions, inputs: GraphInputBinding[], store: SceneSharedStore): GraphOptions;
}

const GROWTH_OPTION_KEYS = new Set<string>([
  'units',
  'expenseViz',
  'weeklyRevenue0',
  'weeklyGrowthRate',
  'grossMargin',
  'weeklyFixedExpenses',
  'yearsMin',
  'yearsMax'
]);

function isGrowthOptionKey(value: string): value is keyof GrowthCalculatorOptions {
  return GROWTH_OPTION_KEYS.has(value);
}

function normalizeGrowthInputs(inputs: GraphInputBinding[]): GraphInputBinding[] {
  return inputs.filter((entry) => isGrowthOptionKey(entry.optionKey));
}

function normalizeGrowthOutputs(outputs: GraphOutputBinding[]): GraphOutputBinding[] {
  return outputs.filter((entry) => {
    if (entry.outputKey === 'graph-id' || entry.outputKey === 'kind') {
      return true;
    }
    return isGrowthOptionKey(entry.outputKey);
  });
}

function applyGrowthStoreInputs(
  options: GraphOptions,
  inputs: GraphInputBinding[],
  store: SceneSharedStore
): GraphOptions {
  const patch: GrowthCalculatorOptions = {};
  inputs.forEach((binding) => {
    if (!isGrowthOptionKey(binding.optionKey)) {
      return;
    }
    const value = store.get(binding.storeKey);
    if (typeof value === 'undefined') {
      return;
    }
    patch[binding.optionKey] = value as never;
  });

  const normalizedPatch = normalizeGrowthOptions(patch);
  if (!Object.keys(normalizedPatch).length) {
    return options;
  }

  return {
    ...options,
    ...normalizedPatch
  };
}

function growthOutputValue(instance: GraphInstance, outputKey: string): unknown {
  if (outputKey === 'graph-id') {
    return instance.graphId;
  }
  if (outputKey === 'kind') {
    return instance.kind;
  }
  return (instance.options as Record<string, unknown>)[outputKey];
}

const growthCalculatorAdapter: GraphAdapter = {
  kind: 'growth-calculator',
  normalizeOptions(options) {
    return normalizeGrowthOptions(options as GrowthCalculatorOptions);
  },
  mount(args) {
    const options = normalizeGrowthOptions(args.options as GrowthCalculatorOptions);
    return mountGrowthWidget({
      graphId: args.graphId,
      mount: args.mount,
      options,
      sceneId: args.sceneId,
      legacyApi: args.legacyApi,
      inputs: args.definition.inputs,
      outputs: args.definition.outputs,
      dependsOn: args.definition.dependsOn
    });
  },
  readOutput(instance, outputKey) {
    return growthOutputValue(instance, outputKey);
  },
  normalizeInputs(inputs) {
    return normalizeGrowthInputs(inputs);
  },
  normalizeOutputs(outputs) {
    return normalizeGrowthOutputs(outputs);
  },
  applyStoreInputs(options, inputs, store) {
    return applyGrowthStoreInputs(options, inputs, store);
  }
};

export class GraphAdapterRegistry {
  private readonly byKind = new Map<GraphKind, GraphAdapter>();

  constructor(adapters: GraphAdapter[] = []) {
    adapters.forEach((adapter) => this.register(adapter));
  }

  register(adapter: GraphAdapter): void {
    this.byKind.set(adapter.kind, adapter);
  }

  unregister(kind: GraphKind): boolean {
    return this.byKind.delete(kind);
  }

  resolve(kind: GraphKind): GraphAdapter | null {
    return this.byKind.get(kind) || null;
  }
}

const baseAdapters: GraphAdapter[] = [growthCalculatorAdapter];
let defaultRegistry = new GraphAdapterRegistry(baseAdapters);

export function registerGraphAdapter(adapter: GraphAdapter): void {
  defaultRegistry.register(adapter);
}

export function unregisterGraphAdapter(kind: GraphKind): boolean {
  return defaultRegistry.unregister(kind);
}

export function resetGraphAdapters(): void {
  defaultRegistry = new GraphAdapterRegistry(baseAdapters);
}

export function resolveGraphAdapter(kind: GraphKind): GraphAdapter | null {
  return defaultRegistry.resolve(kind);
}

export function normalizeGraphOptionsForKind(
  kind: GraphKind,
  options: GraphOptions | undefined
): GraphOptions {
  const adapter = resolveGraphAdapter(kind);
  if (adapter && adapter.normalizeOptions) {
    return adapter.normalizeOptions(options);
  }

  if (!options || typeof options !== 'object') {
    return {};
  }

  return { ...options };
}

export function normalizeGraphInputBindings(
  kind: GraphKind,
  bindings: GraphInputBinding[]
): GraphInputBinding[] {
  const adapter = resolveGraphAdapter(kind);
  if (!adapter || !adapter.normalizeInputs) {
    return bindings;
  }
  return adapter.normalizeInputs(bindings);
}

export function normalizeGraphOutputBindings(
  kind: GraphKind,
  bindings: GraphOutputBinding[]
): GraphOutputBinding[] {
  const adapter = resolveGraphAdapter(kind);
  if (!adapter || !adapter.normalizeOutputs) {
    return bindings;
  }
  return adapter.normalizeOutputs(bindings);
}

export function applyGraphStoreInputs(
  kind: GraphKind,
  options: GraphOptions,
  bindings: GraphInputBinding[],
  store: SceneSharedStore
): GraphOptions {
  const adapter = resolveGraphAdapter(kind);
  if (adapter && adapter.applyStoreInputs) {
    return adapter.applyStoreInputs(options, bindings, store);
  }

  const patch: Record<string, unknown> = {};
  bindings.forEach((binding) => {
    const value = store.get(binding.storeKey);
    if (typeof value === 'undefined') {
      return;
    }
    patch[binding.optionKey] = value;
  });

  if (!Object.keys(patch).length) {
    return options;
  }

  return {
    ...options,
    ...patch
  };
}

export function mountGraphWithAdapter(args: GraphAdapterMountArgs): GraphInstance | null {
  const adapter = resolveGraphAdapter(args.kind);
  if (!adapter) {
    return null;
  }
  return adapter.mount(args);
}

export function readGraphOutputValue(instance: GraphInstance, outputKey: string): unknown {
  const adapter = resolveGraphAdapter(instance.kind);
  if (!adapter) {
    return undefined;
  }
  return adapter.readOutput(instance, outputKey);
}
