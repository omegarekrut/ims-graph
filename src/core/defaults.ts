import type { ExpenseViz, GraphKind, GrowthCalculatorState, Unit } from './contracts';

export const DEFAULT_GRAPH_KIND: GraphKind = 'growth-calculator';

export const DEFAULT_GRAPH_SELECTOR = '#ims-growth-calc';
export const DATA_GRAPH_SELECTOR = '[data-ims-graph]';
export const DATA_SCENE_SELECTOR = '[data-ims-scene]';

export const VALID_UNITS: readonly Unit[] = ['week', 'month', 'quarter', 'year'] as const;
export const VALID_EXPENSE_VIZ: readonly ExpenseViz[] = ['bars', 'lines'] as const;

export const DEFAULT_GROWTH_STATE: GrowthCalculatorState = {
  units: 'week',
  expenseViz: 'bars',
  weeklyRevenue0: 100,
  weeklyGrowthRate: 0.0353,
  grossMargin: 1,
  weeklyFixedExpenses: 1600,
  yearsMin: 1,
  yearsMax: 9,
};
