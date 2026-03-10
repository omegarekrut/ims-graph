import { normalizeGrowthOptions } from '../core/options';
import type {
  GraphMountTarget,
  GrowthCalculatorOptions
} from '../core/contracts';

export function normalizeLegacyTarget(target: GraphMountTarget | null | undefined): GraphMountTarget | null {
  if (typeof target === 'string' && target.trim() === '') {
    return null;
  }

  if (target === null || target === undefined) {
    return null;
  }

  return target;
}

export function normalizeLegacyOptions(options: GrowthCalculatorOptions | undefined): GrowthCalculatorOptions {
  return normalizeGrowthOptions(options);
}
