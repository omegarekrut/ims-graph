import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LegacyGrowthCalculatorApi } from '../../src/core/contracts';
import { mountGrowthWidget } from '../../src/widgets/growth-widget';
import { resetPageLeadGateController } from '../../src/widgets/lead/lead-gate';
import {
  LEAD_GATE_STORAGE_KEY,
  readCalculatorSnapshot,
  readLeadGateStorage,
  resolveLeadGatePageScope,
  writeCalculatorSnapshot,
} from '../../src/widgets/lead/lead-storage';

function createLegacyApi(
  initImpl: (target: string | Element, options?: Record<string, unknown>) => unknown
): LegacyGrowthCalculatorApi {
  return {
    init: initImpl,
    autoInit: () => [],
  };
}

afterEach(() => {
  resetPageLeadGateController();
  document.body.innerHTML = '';
  window.localStorage.removeItem(LEAD_GATE_STORAGE_KEY);
});

describe('mountGrowthWidget', () => {
  it('merges a stored snapshot into options before legacy init', () => {
    const mount = document.createElement('div');
    mount.setAttribute('data-ims-graph', 'calculator-main');
    document.body.appendChild(mount);

    writeCalculatorSnapshot(resolveLeadGatePageScope('/'), 'graph:calculator-main', {
      weeklyRevenue0: 900,
      weeklyGrowthRate: 0.06,
    });

    const initSpy = vi.fn((target: string | Element, options?: Record<string, unknown>) => ({
      target,
      state: {
        ...options,
      },
    }));

    const graph = mountGrowthWidget({
      graphId: 'calculator-main',
      mount,
      options: {
        weeklyRevenue0: 100,
        grossMargin: 0.35,
      },
      legacyApi: createLegacyApi(initSpy),
    });

    expect(initSpy).toHaveBeenCalledTimes(1);
    expect(initSpy.mock.calls[0]?.[1]).toEqual({
      weeklyRevenue0: 900,
      weeklyGrowthRate: 0.06,
      grossMargin: 0.35,
    });
    expect(graph.options.weeklyRevenue0).toBe(900);
    expect(graph.options.grossMargin).toBe(0.35);
  });

  it('uses canonical post-mount legacy state for runtime options and persistence', () => {
    const mount = document.createElement('div');
    mount.setAttribute('data-ims-graph', 'calculator-main');
    document.body.appendChild(mount);

    const initSpy = vi.fn(() => ({
      state: {
        units: 'year',
        expenseViz: 'lines',
        weeklyRevenue0: 222,
        weeklyGrowthRate: 0.04,
        grossMargin: 0.61,
        weeklyFixedExpenses: 1200,
        yearsMin: 2,
        yearsMax: 7,
      },
    }));

    const graph = mountGrowthWidget({
      graphId: 'calculator-main',
      mount,
      options: {
        weeklyRevenue0: -50,
        yearsMax: 999,
      },
      legacyApi: createLegacyApi(initSpy),
    });

    expect(initSpy).toHaveBeenCalledTimes(1);
    expect(graph.options).toMatchObject({
      units: 'year',
      expenseViz: 'lines',
      weeklyRevenue0: 222,
      weeklyGrowthRate: 0.04,
      grossMargin: 0.61,
      weeklyFixedExpenses: 1200,
      yearsMin: 2,
      yearsMax: 7,
    });

    const snapshot = readCalculatorSnapshot(resolveLeadGatePageScope('/'), 'graph:calculator-main');
    expect(snapshot).toEqual({
      units: 'year',
      expenseViz: 'lines',
      weeklyRevenue0: 222,
      weeklyGrowthRate: 0.04,
      grossMargin: 0.61,
      weeklyFixedExpenses: 1200,
      yearsMin: 2,
      yearsMax: 7,
    });
  });

  it('does not re-apply saved snapshot on remount of the same mount', () => {
    const mount = document.createElement('div');
    mount.setAttribute('data-ims-graph', 'calculator-main');
    document.body.appendChild(mount);

    writeCalculatorSnapshot(resolveLeadGatePageScope('/'), 'graph:calculator-main', {
      weeklyRevenue0: 900,
    });

    const initSpy = vi.fn((target: string | Element, options?: Record<string, unknown>) => ({
      target,
      state: {
        ...options,
      },
    }));

    mountGrowthWidget({
      graphId: 'calculator-main',
      mount,
      options: {
        weeklyRevenue0: 100,
      },
      legacyApi: createLegacyApi(initSpy),
    });

    mountGrowthWidget({
      graphId: 'calculator-main',
      mount,
      options: {
        weeklyRevenue0: 500,
      },
      legacyApi: createLegacyApi(initSpy),
    });

    expect(initSpy).toHaveBeenCalledTimes(2);
    expect(initSpy.mock.calls[0]?.[1]).toMatchObject({
      weeklyRevenue0: 900,
    });
    expect(initSpy.mock.calls[1]?.[1]).toMatchObject({
      weeklyRevenue0: 500,
    });
  });

  it('does not retroactively apply snapshot state when the first mount had no snapshot', () => {
    const mount = document.createElement('div');
    mount.setAttribute('data-ims-graph', 'calculator-main');
    document.body.appendChild(mount);

    const initSpy = vi.fn((target: string | Element, options?: Record<string, unknown>) => ({
      target,
      state: {
        ...options,
      },
    }));

    mountGrowthWidget({
      graphId: 'calculator-main',
      mount,
      options: {
        weeklyRevenue0: 100,
      },
      legacyApi: createLegacyApi(initSpy),
    });

    writeCalculatorSnapshot(resolveLeadGatePageScope('/'), 'graph:calculator-main', {
      weeklyRevenue0: 700,
    });

    mountGrowthWidget({
      graphId: 'calculator-main',
      mount,
      options: {
        weeklyRevenue0: 500,
      },
      legacyApi: createLegacyApi(initSpy),
    });

    expect(initSpy).toHaveBeenCalledTimes(2);
    expect(initSpy.mock.calls[0]?.[1]).toMatchObject({
      weeklyRevenue0: 100,
    });
    expect(initSpy.mock.calls[1]?.[1]).toMatchObject({
      weeklyRevenue0: 500,
    });
  });

  it('does not consume restore state when legacy init fails', () => {
    const mount = document.createElement('div');
    mount.setAttribute('data-ims-graph', 'calculator-main');
    document.body.appendChild(mount);

    writeCalculatorSnapshot(resolveLeadGatePageScope('/'), 'graph:calculator-main', {
      weeklyRevenue0: 900,
    });

    const failingInit = vi.fn(() => null);
    mountGrowthWidget({
      graphId: 'calculator-main',
      mount,
      options: {
        weeklyRevenue0: 100,
      },
      legacyApi: createLegacyApi(failingInit),
    });

    const succeedingInit = vi.fn((target: string | Element, options?: Record<string, unknown>) => ({
      target,
      state: {
        ...options,
      },
    }));
    mountGrowthWidget({
      graphId: 'calculator-main',
      mount,
      options: {
        weeklyRevenue0: 500,
      },
      legacyApi: createLegacyApi(succeedingInit),
    });

    expect(failingInit).toHaveBeenCalledTimes(1);
    expect(succeedingInit).toHaveBeenCalledTimes(1);
    expect(succeedingInit.mock.calls[0]?.[1]).toMatchObject({
      weeklyRevenue0: 900,
    });
  });

  it('does not consume restore state when legacy api is unavailable', () => {
    const mount = document.createElement('div');
    mount.setAttribute('data-ims-graph', 'calculator-main');
    document.body.appendChild(mount);

    writeCalculatorSnapshot(resolveLeadGatePageScope('/'), 'graph:calculator-main', {
      weeklyRevenue0: 900,
    });

    mountGrowthWidget({
      graphId: 'calculator-main',
      mount,
      options: {
        weeklyRevenue0: 100,
      },
      legacyApi: null,
    });

    const succeedingInit = vi.fn((target: string | Element, options?: Record<string, unknown>) => ({
      target,
      state: {
        ...options,
      },
    }));
    mountGrowthWidget({
      graphId: 'calculator-main',
      mount,
      options: {
        weeklyRevenue0: 500,
      },
      legacyApi: createLegacyApi(succeedingInit),
    });

    expect(succeedingInit).toHaveBeenCalledTimes(1);
    expect(succeedingInit.mock.calls[0]?.[1]).toMatchObject({
      weeklyRevenue0: 900,
    });
  });

  it('skips persistence when mount identity is unstable on multi-mount pages', () => {
    const mountA = document.createElement('div');
    mountA.setAttribute('data-ims-graph', '');
    const mountB = document.createElement('div');
    mountB.setAttribute('data-ims-graph', '');
    document.body.appendChild(mountA);
    document.body.appendChild(mountB);

    const initSpy = vi.fn(() => ({
      state: {
        weeklyRevenue0: 333,
      },
    }));

    const graph = mountGrowthWidget({
      graphId: 'graph-a',
      mount: mountA,
      options: {
        weeklyRevenue0: 10,
      },
      legacyApi: createLegacyApi(initSpy),
    });

    expect(graph.options.weeklyRevenue0).toBe(333);
    expect(Object.keys(readLeadGateStorage().pages)).toHaveLength(0);
  });
});
