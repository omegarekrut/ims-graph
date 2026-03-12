import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { LEGACY_GOLDEN_FIXTURES } from './fixtures/legacy-golden-fixtures';

interface LegacyMetrics {
  breakevenYears: number | null;
  billionYears: number | null;
}

interface LegacyNodes {
  inputRevenue: HTMLInputElement;
  inputGrossMargin: HTMLInputElement;
  inputFixed: HTMLInputElement;
  inputGrowth: HTMLInputElement;
  summaryBreakeven: Element;
  summaryBillion: Element;
}

interface LegacyState {
  units: string;
  expenseViz: string;
  weeklyRevenue0: number;
  weeklyGrowthRate: number;
  grossMargin: number;
  weeklyFixedExpenses: number;
  yearsMin: number;
  yearsMax: number;
}

interface LegacyChart {
  height: number;
  paddingBottom: number;
  yMin: number;
  yMax: number;
  ticksY: number[];
}

interface LegacyInstance {
  state: LegacyState;
  chart: LegacyChart;
  nodes: LegacyNodes;
  _computeMetrics(): LegacyMetrics;
  _updateYDomain(): void;
  _revenueAt(timeYears: number): number;
  render(options?: Record<string, unknown>): void;
}

interface LegacyApi {
  init(target: string | Element, options?: Record<string, unknown>): LegacyInstance | null;
  autoInit(): LegacyInstance[];
}

function getLegacyApi(): LegacyApi {
  const runtime = window as Window & {
    ImsGrowthCalculator?: LegacyApi;
  };
  if (!runtime.ImsGrowthCalculator) {
    throw new Error('Legacy runtime is not installed');
  }
  return runtime.ImsGrowthCalculator;
}

function createMount(id: string): HTMLDivElement {
  const mount = document.createElement('div');
  mount.id = id;
  document.body.appendChild(mount);
  return mount;
}

function dispatchBlur(input: HTMLInputElement): void {
  input.dispatchEvent(new Event('blur', { bubbles: true }));
}

function parsePolylineYValues(points: string): number[] {
  return points
    .trim()
    .split(/\s+/)
    .map((point) => point.split(','))
    .map((pair) => Number.parseFloat(pair[1] ?? ''))
    .filter((value) => Number.isFinite(value));
}

function uniqueRoundedCount(values: number[], digits = 4): number {
  return new Set(values.map((value) => value.toFixed(digits))).size;
}

const TEST_WEEKS_PER_YEAR = 52.1775;
const TEST_WEEKS_PER_QUARTER = TEST_WEEKS_PER_YEAR / 4;
const TEST_WEEKS_PER_MONTH = TEST_WEEKS_PER_YEAR / 12;

function testUnitWeeks(units: string): number {
  if (units === 'week') {
    return 1;
  }
  if (units === 'month') {
    return TEST_WEEKS_PER_MONTH;
  }
  if (units === 'quarter') {
    return TEST_WEEKS_PER_QUARTER;
  }
  return TEST_WEEKS_PER_YEAR;
}

function toDisplayFromWeekly(value: number, units: string): number {
  return value * testUnitWeeks(units);
}

function toWeeklyFromDisplay(value: number, units: string): number {
  return value / testUnitWeeks(units);
}

const YEAR_BARS_LOW_REVENUE_OPTIONS = {
  units: 'year',
  expenseViz: 'bars',
  grossMargin: 0.1,
  weeklyFixedExpenses: 0,
  yearsMin: 1,
  yearsMax: 9,
} as const;

function createYearBarsLowRevenueInstance(
  api: LegacyApi,
  mountId: string
): {
  mount: HTMLDivElement;
  instance: LegacyInstance | null;
} {
  const mount = createMount(mountId);
  return {
    mount: mount,
    instance: api.init(mount, YEAR_BARS_LOW_REVENUE_OPTIONS),
  };
}

function applyLowRevenueGrowthAndMarginInputs(instance: LegacyInstance): void {
  instance.nodes.inputGrossMargin.value = '10%';
  dispatchBlur(instance.nodes.inputGrossMargin);
  instance.nodes.inputGrowth.value = '12%';
  dispatchBlur(instance.nodes.inputGrowth);
}

beforeAll(async () => {
  const runtime = window as Window & {
    __IMS_GRAPH_DISABLE_LEGACY_AUTO_INIT?: boolean;
  };
  runtime.__IMS_GRAPH_DISABLE_LEGACY_AUTO_INIT = true;
  const currentFile = fileURLToPath(import.meta.url);
  const currentDir = path.dirname(currentFile);
  const legacyScriptPath = path.resolve(currentDir, '../../webflow-growth-calculator.js');
  const legacySource = readFileSync(legacyScriptPath, 'utf8');
  window.eval(legacySource);
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('legacy calculator golden behavior', () => {
  it('matches golden fixtures for metrics, formatted values, and y-domain', () => {
    const api = getLegacyApi();

    LEGACY_GOLDEN_FIXTURES.forEach((fixture, index) => {
      const mount = createMount(`ims-growth-calc-${index + 1}`);
      const instance = api.init(mount, fixture.options);
      expect(instance).not.toBeNull();
      if (!instance) {
        return;
      }

      instance._updateYDomain();
      const metrics = instance._computeMetrics();

      expect(metrics.breakevenYears).toBeCloseTo(fixture.metrics.breakevenYears, 10);
      expect(metrics.billionYears).toBeCloseTo(fixture.metrics.billionYears, 10);
      expect(instance.nodes.summaryBreakeven.textContent).toBe(fixture.summary.breakeven);
      expect(instance.nodes.summaryBillion.textContent).toBe(fixture.summary.billion);
      expect(instance.nodes.inputRevenue.value).toBe(fixture.inputs.revenue);
      expect(instance.nodes.inputGrossMargin.value).toBe(fixture.inputs.grossMargin);
      expect(instance.nodes.inputFixed.value).toBe(fixture.inputs.fixed);
      expect(instance.nodes.inputGrowth.value).toBe(fixture.inputs.growth);
      expect(instance.chart.ticksY.length).toBe(fixture.yDomain.tickCount);
      expect(instance.chart.ticksY[0]).toBeCloseTo(fixture.yDomain.firstTick, 10);
      expect(instance.chart.ticksY[instance.chart.ticksY.length - 1]).toBeCloseTo(
        fixture.yDomain.lastTick,
        10
      );
    });
  });

  it('clamps invalid input options to safe boundaries', () => {
    const api = getLegacyApi();
    const mount = createMount('ims-growth-calc-clamps');
    const instance = api.init(mount, {
      units: 'bad-unit',
      expenseViz: 'bad-expense-viz',
      weeklyRevenue0: -100,
      weeklyGrowthRate: 999,
      grossMargin: -10,
      weeklyFixedExpenses: -500,
      yearsMin: 0,
      yearsMax: 500,
    });

    expect(instance).not.toBeNull();
    if (!instance) {
      return;
    }

    expect(instance.state.units).toBe('year');
    expect(instance.state.expenseViz).toBe('bars');
    expect(instance.state.weeklyRevenue0).toBeGreaterThan(0);
    expect(instance.state.weeklyGrowthRate).toBeGreaterThanOrEqual(-0.9);
    expect(instance.state.weeklyGrowthRate).toBeLessThanOrEqual(10);
    expect(instance.state.grossMargin).toBe(0);
    expect(instance.state.weeklyFixedExpenses).toBeGreaterThanOrEqual(0);
    expect(instance.state.yearsMin).toBeGreaterThanOrEqual(1);
    expect(instance.state.yearsMax).toBeLessThanOrEqual(100);
    expect(instance.state.yearsMax).toBeGreaterThan(instance.state.yearsMin);
  });

  it('applies unit conversions and parser/formatter behavior through inputs', () => {
    const api = getLegacyApi();
    const mount = createMount('ims-growth-calc-inputs');
    const instance = api.init(mount, {});
    expect(instance).not.toBeNull();
    if (!instance) {
      return;
    }

    const monthRadio = mount.querySelector(
      'input[data-group="units"][value="month"]'
    ) as HTMLInputElement | null;
    expect(monthRadio).not.toBeNull();
    if (!monthRadio) {
      return;
    }
    monthRadio.checked = true;
    monthRadio.dispatchEvent(new Event('change', { bubbles: true }));

    expect(instance.state.units).toBe('month');
    expect(instance.nodes.inputRevenue.value).toBe('$435');

    instance.nodes.inputRevenue.value = '$5,217.4';
    dispatchBlur(instance.nodes.inputRevenue);

    expect(instance.nodes.inputRevenue.value).toBe('$5,217');
    expect(instance.state.weeklyRevenue0).toBeCloseTo(1199.8275118585595, 10);

    instance.nodes.inputGrowth.value = '8.99%';
    dispatchBlur(instance.nodes.inputGrowth);

    expect(instance.nodes.inputGrowth.value).toBe('8.99%');
    expect(instance.state.weeklyGrowthRate).toBeCloseTo(0.02, 4);
  });

  it('keeps growth math, KPI math, and y-domain helpers consistent', () => {
    const api = getLegacyApi();
    const mount = createMount('ims-growth-calc-math');
    const instance = api.init(mount, {
      weeklyRevenue0: 150,
      weeklyGrowthRate: 0.025,
      grossMargin: 0.7,
      weeklyFixedExpenses: 2100,
      yearsMin: 1,
      yearsMax: 7,
    });
    expect(instance).not.toBeNull();
    if (!instance) {
      return;
    }

    const revenueYear1 = instance._revenueAt(1);
    const revenueYear3 = instance._revenueAt(3);
    expect(revenueYear3).toBeGreaterThan(revenueYear1);

    const metrics = instance._computeMetrics();
    expect(metrics.breakevenYears).not.toBeNull();
    expect(metrics.billionYears).not.toBeNull();

    instance._updateYDomain();
    expect(instance.chart.yMin).toBeGreaterThan(0);
    expect(instance.chart.yMax).toBeGreaterThan(instance.chart.yMin);

    instance.chart.ticksY.forEach((tick, index) => {
      expect(tick).toBeGreaterThan(instance.chart.yMin);
      expect(tick).toBeLessThan(instance.chart.yMax);
      if (index > 0) {
        expect(tick).toBeGreaterThan(instance.chart.ticksY[index - 1] as number);
      }
    });
  });

  it('keeps yearly 1000 at the unit floor and lowers it for yearly 999 via input apply', () => {
    const api = getLegacyApi();
    const { instance } = createYearBarsLowRevenueInstance(
      api,
      'ims-growth-calc-year-floor-threshold'
    );
    expect(instance).not.toBeNull();
    if (!instance) {
      return;
    }

    applyLowRevenueGrowthAndMarginInputs(instance);
    instance.nodes.inputFixed.value = '$0';
    dispatchBlur(instance.nodes.inputFixed);

    instance.nodes.inputRevenue.value = '$1,000';
    dispatchBlur(instance.nodes.inputRevenue);
    expect(instance.chart.yMin).toBeCloseTo(toWeeklyFromDisplay(900, 'year'), 10);

    instance.nodes.inputRevenue.value = '$999';
    dispatchBlur(instance.nodes.inputRevenue);
    expect(instance.chart.yMin).toBeLessThan(toWeeklyFromDisplay(900, 'year'));
  });

  it('covers low yearly revenue values through display-input apply and keeps chart geometry non-flat', () => {
    const api = getLegacyApi();
    const { mount, instance } = createYearBarsLowRevenueInstance(
      api,
      'ims-growth-calc-year-low-table'
    );
    expect(instance).not.toBeNull();
    if (!instance) {
      return;
    }

    applyLowRevenueGrowthAndMarginInputs(instance);

    const cases = [
      {
        revenueDisplay: 1000,
        fixedDisplay: 0,
        shouldLowerFloor: false,
        expectFixedBars: false,
        expectBelowFloorTick: false,
      },
      {
        revenueDisplay: 999,
        fixedDisplay: 0,
        shouldLowerFloor: true,
        expectFixedBars: false,
        expectBelowFloorTick: false,
      },
      {
        revenueDisplay: 500,
        fixedDisplay: 300,
        shouldLowerFloor: true,
        expectFixedBars: true,
        expectBelowFloorTick: false,
      },
      {
        revenueDisplay: 1,
        fixedDisplay: 300,
        shouldLowerFloor: true,
        expectFixedBars: true,
        expectBelowFloorTick: true,
      },
    ];
    const unitFloorWeekly = toWeeklyFromDisplay(900, 'year');
    const plotBottomY = instance.chart.height - instance.chart.paddingBottom;

    cases.forEach(
      ({
        revenueDisplay,
        fixedDisplay,
        shouldLowerFloor,
        expectFixedBars,
        expectBelowFloorTick,
      }) => {
        instance.nodes.inputFixed.value = `$${fixedDisplay.toLocaleString('en-US')}`;
        dispatchBlur(instance.nodes.inputFixed);
        instance.nodes.inputRevenue.value = `$${revenueDisplay.toLocaleString('en-US')}`;
        dispatchBlur(instance.nodes.inputRevenue);

        expect(Number.isFinite(instance.chart.yMin)).toBe(true);
        expect(Number.isFinite(instance.chart.yMax)).toBe(true);
        expect(instance.chart.yMin).toBeGreaterThan(0);
        expect(instance.chart.yMax).toBeGreaterThan(instance.chart.yMin);

        if (shouldLowerFloor) {
          expect(instance.chart.yMin).toBeLessThan(unitFloorWeekly);
        } else {
          expect(instance.chart.yMin).toBeCloseTo(unitFloorWeekly, 10);
        }

        const displayTicks = instance.chart.ticksY.map((tick) => toDisplayFromWeekly(tick, 'year'));
        displayTicks.forEach((tick, index) => {
          expect(tick).toBeGreaterThan(0);
          if (index > 0) {
            expect(tick).toBeGreaterThan(displayTicks[index - 1] as number);
          }
        });
        const minDisplayTick = Math.min(...displayTicks);
        if (shouldLowerFloor) {
          expect(minDisplayTick).toBeLessThanOrEqual(1000);
        }
        if (expectBelowFloorTick) {
          expect(displayTicks.some((tick) => tick < 900)).toBe(true);
        }

        const revenuePolyline = mount.querySelector(
          'svg polyline[stroke="#63C56B"]'
        ) as SVGPolylineElement | null;
        expect(revenuePolyline).not.toBeNull();
        if (!revenuePolyline) {
          return;
        }

        const yValues = parsePolylineYValues(revenuePolyline.getAttribute('points') || '');
        expect(yValues.length).toBeGreaterThan(2);
        expect(uniqueRoundedCount(yValues)).toBeGreaterThan(1);
        expect(yValues.every((y) => Math.abs(y - plotBottomY) < 1e-4)).toBe(false);

        const variableRects = Array.from(
          mount.querySelectorAll('svg rect[fill="#E6A7BC"]')
        ) as SVGRectElement[];
        expect(variableRects.length).toBeGreaterThan(0);
        const hasVisibleVariableBar = variableRects.some((rect) => {
          const height = Number.parseFloat(rect.getAttribute('height') || '0');
          return Number.isFinite(height) && height > 0.1;
        });
        expect(hasVisibleVariableBar).toBe(true);

        if (expectFixedBars) {
          const fixedRects = Array.from(
            mount.querySelectorAll('svg rect[fill="#D4D4DE"]')
          ) as SVGRectElement[];
          expect(fixedRects.length).toBeGreaterThan(0);
          const hasVisibleFixedBar = fixedRects.some((rect) => {
            const height = Number.parseFloat(rect.getAttribute('height') || '0');
            return Number.isFinite(height) && height > 0.1;
          });
          expect(hasVisibleFixedBar).toBe(true);
        }
      }
    );
  });

  it('extends low-end ticks below month floor when month domain opens downward', () => {
    const api = getLegacyApi();
    const mount = createMount('ims-growth-calc-month-low-ticks');
    const instance = api.init(mount, {
      ...YEAR_BARS_LOW_REVENUE_OPTIONS,
      units: 'month',
    });
    expect(instance).not.toBeNull();
    if (!instance) {
      return;
    }

    applyLowRevenueGrowthAndMarginInputs(instance);
    instance.nodes.inputFixed.value = '$0';
    dispatchBlur(instance.nodes.inputFixed);
    instance.nodes.inputRevenue.value = '$1';
    dispatchBlur(instance.nodes.inputRevenue);

    expect(instance.chart.yMin).toBeLessThan(toWeeklyFromDisplay(90, 'month'));

    const monthDisplayTicks = instance.chart.ticksY.map((tick) =>
      toDisplayFromWeekly(tick, 'month')
    );
    monthDisplayTicks.forEach((tick, index) => {
      expect(tick).toBeGreaterThan(0);
      if (index > 0) {
        expect(tick).toBeGreaterThan(monthDisplayTicks[index - 1] as number);
      }
    });
    expect(monthDisplayTicks.some((tick) => tick < 90)).toBe(true);
  });
});
