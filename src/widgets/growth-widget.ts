import type {
  GraphDependency,
  GraphId,
  GraphInputBinding,
  GraphInstance,
  GraphOutputBinding,
  GrowthCalculatorOptions,
  LegacyGrowthCalculatorApi,
  SceneId,
} from '../core/contracts';
import { defaultedGrowthOptions, normalizeGrowthOptions } from '../core/options';
import {
  mergeGrowthOptionsWithSnapshot,
  readCanonicalGrowthSnapshotFromLegacyInstance,
} from './lead/growth-snapshot';
import { getPageLeadGateController } from './lead/lead-gate';

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
  const leadGateController = getPageLeadGateController();
  leadGateController?.registerCalculatorMount(args.mount, args.graphId);

  const normalizedOptions = normalizeGrowthOptions(args.options);
  const restoreCandidate = leadGateController?.readSnapshotRestoreCandidateForMount(args.mount);
  const restoredSnapshot = restoreCandidate?.snapshot || null;
  const mountOptions = mergeGrowthOptionsWithSnapshot(normalizedOptions, restoredSnapshot);
  const legacyInstance = args.legacyApi ? args.legacyApi.init(args.mount, mountOptions) : null;
  if (legacyInstance !== null) {
    restoreCandidate?.commit();
  }
  const canonicalSnapshot = readCanonicalGrowthSnapshotFromLegacyInstance(legacyInstance);

  if (canonicalSnapshot) {
    leadGateController?.writeSnapshotForMount(args.mount, canonicalSnapshot);
  }
  if (legacyInstance !== null) {
    leadGateController?.registerCalculatorInstance(args.mount, legacyInstance);
  }

  return {
    graphId: args.graphId,
    kind: 'growth-calculator',
    mount: args.mount,
    options: defaultedGrowthOptions(canonicalSnapshot || mountOptions),
    legacyInstance,
    inputs: args.inputs || [],
    outputs: args.outputs || [],
    dependsOn: args.dependsOn || [],
    sceneId: args.sceneId || null,
    createdAtMs: Date.now(),
  };
}
