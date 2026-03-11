import type { ExpenseViz, GrowthCalculatorOptions, Unit } from './contracts';
import { DEFAULT_GROWTH_STATE, VALID_EXPENSE_VIZ, VALID_UNITS } from './defaults';

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && !Number.isNaN(value);
}

function isUnit(value: unknown): value is Unit {
  return typeof value === 'string' && (VALID_UNITS as readonly string[]).includes(value);
}

function isExpenseViz(value: unknown): value is ExpenseViz {
  return typeof value === 'string' && (VALID_EXPENSE_VIZ as readonly string[]).includes(value);
}

function parseOptionalNumber(value: string | undefined): number | undefined {
  if (typeof value !== 'string' || value.trim() === '') {
    return undefined;
  }
  const parsed = Number(value);
  return isFiniteNumber(parsed) ? parsed : undefined;
}

function readDataValue(el: Element, name: string): string | undefined {
  const value = el.getAttribute(name);
  return typeof value === 'string' ? value : undefined;
}

export function normalizeGrowthOptions(
  options: GrowthCalculatorOptions | undefined
): GrowthCalculatorOptions {
  if (!options) {
    return {};
  }

  const normalized: GrowthCalculatorOptions = {};

  if (isUnit(options.units)) {
    normalized.units = options.units;
  }
  if (isExpenseViz(options.expenseViz)) {
    normalized.expenseViz = options.expenseViz;
  }

  if (isFiniteNumber(options.weeklyRevenue0)) {
    normalized.weeklyRevenue0 = options.weeklyRevenue0;
  }
  if (isFiniteNumber(options.weeklyGrowthRate)) {
    normalized.weeklyGrowthRate = options.weeklyGrowthRate;
  }
  if (isFiniteNumber(options.grossMargin)) {
    normalized.grossMargin = options.grossMargin;
  }
  if (isFiniteNumber(options.weeklyFixedExpenses)) {
    normalized.weeklyFixedExpenses = options.weeklyFixedExpenses;
  }
  if (isFiniteNumber(options.yearsMin)) {
    normalized.yearsMin = options.yearsMin;
  }
  if (isFiniteNumber(options.yearsMax)) {
    normalized.yearsMax = options.yearsMax;
  }

  return normalized;
}

export function readGrowthOptionsFromElement(el: Element): GrowthCalculatorOptions {
  const parsedUnits = readDataValue(el, 'data-ims-units');
  const parsedExpenseViz = readDataValue(el, 'data-ims-expense-viz');

  const options: GrowthCalculatorOptions = {
    units: isUnit(parsedUnits) ? parsedUnits : undefined,
    expenseViz: isExpenseViz(parsedExpenseViz) ? parsedExpenseViz : undefined,
    weeklyRevenue0: parseOptionalNumber(readDataValue(el, 'data-ims-weekly-revenue0')),
    weeklyGrowthRate: parseOptionalNumber(readDataValue(el, 'data-ims-weekly-growth-rate')),
    grossMargin: parseOptionalNumber(readDataValue(el, 'data-ims-gross-margin')),
    weeklyFixedExpenses: parseOptionalNumber(readDataValue(el, 'data-ims-weekly-fixed-expenses')),
    yearsMin: parseOptionalNumber(readDataValue(el, 'data-ims-years-min')),
    yearsMax: parseOptionalNumber(readDataValue(el, 'data-ims-years-max')),
  };

  return normalizeGrowthOptions(options);
}

export function defaultedGrowthOptions(
  options: GrowthCalculatorOptions | undefined
): GrowthCalculatorOptions {
  const normalized = normalizeGrowthOptions(options);

  return {
    units: normalized.units || DEFAULT_GROWTH_STATE.units,
    expenseViz: normalized.expenseViz || DEFAULT_GROWTH_STATE.expenseViz,
    weeklyRevenue0: normalized.weeklyRevenue0 ?? DEFAULT_GROWTH_STATE.weeklyRevenue0,
    weeklyGrowthRate: normalized.weeklyGrowthRate ?? DEFAULT_GROWTH_STATE.weeklyGrowthRate,
    grossMargin: normalized.grossMargin ?? DEFAULT_GROWTH_STATE.grossMargin,
    weeklyFixedExpenses: normalized.weeklyFixedExpenses ?? DEFAULT_GROWTH_STATE.weeklyFixedExpenses,
    yearsMin: normalized.yearsMin ?? DEFAULT_GROWTH_STATE.yearsMin,
    yearsMax: normalized.yearsMax ?? DEFAULT_GROWTH_STATE.yearsMax,
  };
}
