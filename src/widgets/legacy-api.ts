import '../shared/runtime-flags';
import '../../webflow-growth-calculator.js';

import type { LegacyGrowthCalculatorApi } from '../core/contracts';

const LEGACY_API: LegacyGrowthCalculatorApi | null =
  typeof window === 'undefined' ? null : (window.ImsGrowthCalculator as LegacyGrowthCalculatorApi | undefined) || null;

export function getLegacyApi(): LegacyGrowthCalculatorApi | null {
  return LEGACY_API;
}
