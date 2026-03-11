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
});
