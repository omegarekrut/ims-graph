import {
  defaultedGrowthOptions,
  normalizeGrowthOptions
} from '../core/options';
import type {
  GraphDependency,
  GraphId,
  GraphInputBinding,
  GraphInstance,
  GraphOutputBinding,
  GrowthCalculatorOptions,
  LegacyGrowthCalculatorApi,
  SceneId
} from '../core/contracts';

export interface MountGrowthWidgetArgs {
  graphId: GraphId;
  mount: Element;
  options?: GrowthCalculatorOptions;
  sceneId?: SceneId | null;
  legacyApi: LegacyGrowthCalculatorApi | null;
  inputs?: GraphInputBinding[];
  outputs?: GraphOutputBinding[];
  dependsOn?: GraphDependency[];
}

export function mountGrowthWidget(args: MountGrowthWidgetArgs): GraphInstance {
  const normalizedOptions = normalizeGrowthOptions(args.options);
  const legacyInstance = args.legacyApi ? args.legacyApi.init(args.mount, normalizedOptions) : null;

  return {
    graphId: args.graphId,
    kind: 'growth-calculator',
    mount: args.mount,
    options: defaultedGrowthOptions(normalizedOptions),
    legacyInstance,
    inputs: args.inputs || [],
    outputs: args.outputs || [],
    dependsOn: args.dependsOn || [],
    sceneId: args.sceneId || null,
    createdAtMs: Date.now()
  };
}
