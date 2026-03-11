import type { GrowthCalculatorOptions } from '../../core/contracts';
import { normalizeGrowthOptions } from '../../core/options';

const GROWTH_SNAPSHOT_KEYS: (keyof GrowthCalculatorOptions)[] = [
  'units',
  'expenseViz',
  'weeklyRevenue0',
  'weeklyGrowthRate',
  'grossMargin',
  'weeklyFixedExpenses',
  'yearsMin',
  'yearsMax',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function mergeGrowthOptionsWithSnapshot(
  options: GrowthCalculatorOptions | undefined,
  snapshot: GrowthCalculatorOptions | null
): GrowthCalculatorOptions {
  const normalizedOptions = normalizeGrowthOptions(options);
  if (!snapshot) {
    return normalizedOptions;
  }

  return normalizeGrowthOptions({
    ...normalizedOptions,
    ...snapshot,
  });
}

export function readCanonicalGrowthSnapshotFromLegacyInstance(
  legacyInstance: unknown
): GrowthCalculatorOptions | null {
  if (!isRecord(legacyInstance)) {
    return null;
  }

  const state = legacyInstance.state;
  if (!isRecord(state)) {
    return null;
  }

  const snapshotCandidate: GrowthCalculatorOptions = {};

  GROWTH_SNAPSHOT_KEYS.forEach((key) => {
    const value = state[key as string];
    if (typeof value === 'undefined') {
      return;
    }
    snapshotCandidate[key] = value as never;
  });

  const normalized = normalizeGrowthOptions(snapshotCandidate);
  if (!Object.keys(normalized).length) {
    return null;
  }

  return normalized;
}
