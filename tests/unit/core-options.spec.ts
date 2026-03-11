import { describe, expect, it } from 'vitest';

import { DEFAULT_GROWTH_STATE } from '../../src/core/defaults';
import {
  defaultedGrowthOptions,
  normalizeGrowthOptions,
  readGrowthOptionsFromElement,
} from '../../src/core/options';

describe('core growth options', () => {
  it('normalizes only valid enum and finite-number values', () => {
    const normalized = normalizeGrowthOptions({
      units: 'month',
      expenseViz: 'lines',
      weeklyRevenue0: 420,
      weeklyGrowthRate: Number.POSITIVE_INFINITY,
      grossMargin: Number.NaN,
      weeklyFixedExpenses: 3000,
      yearsMin: 2,
      yearsMax: 8,
    });

    expect(normalized).toEqual({
      units: 'month',
      expenseViz: 'lines',
      weeklyRevenue0: 420,
      weeklyFixedExpenses: 3000,
      yearsMin: 2,
      yearsMax: 8,
    });
  });

  it('reads and parses valid growth options from data attributes', () => {
    const mount = document.createElement('div');
    mount.setAttribute('data-ims-units', 'quarter');
    mount.setAttribute('data-ims-expense-viz', 'bars');
    mount.setAttribute('data-ims-weekly-revenue0', '225');
    mount.setAttribute('data-ims-weekly-growth-rate', '0.07');
    mount.setAttribute('data-ims-gross-margin', '0.65');
    mount.setAttribute('data-ims-weekly-fixed-expenses', '1800');
    mount.setAttribute('data-ims-years-min', '3');
    mount.setAttribute('data-ims-years-max', '11');

    expect(readGrowthOptionsFromElement(mount)).toEqual({
      units: 'quarter',
      expenseViz: 'bars',
      weeklyRevenue0: 225,
      weeklyGrowthRate: 0.07,
      grossMargin: 0.65,
      weeklyFixedExpenses: 1800,
      yearsMin: 3,
      yearsMax: 11,
    });
  });

  it('ignores invalid data attributes', () => {
    const mount = document.createElement('div');
    mount.setAttribute('data-ims-units', 'invalid');
    mount.setAttribute('data-ims-expense-viz', 'invalid');
    mount.setAttribute('data-ims-weekly-revenue0', 'abc');
    mount.setAttribute('data-ims-weekly-growth-rate', '');
    mount.setAttribute('data-ims-gross-margin', 'NaN');
    mount.setAttribute('data-ims-weekly-fixed-expenses', '1e9999');
    mount.setAttribute('data-ims-years-min', ' ');
    mount.setAttribute('data-ims-years-max', 'text');

    expect(readGrowthOptionsFromElement(mount)).toEqual({});
  });

  it('applies defaults after normalization', () => {
    const options = defaultedGrowthOptions({
      weeklyRevenue0: 900,
    });

    expect(options).toEqual({
      ...DEFAULT_GROWTH_STATE,
      weeklyRevenue0: 900,
    });
  });
});
