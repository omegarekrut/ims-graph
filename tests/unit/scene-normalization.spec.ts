import { describe, expect, it } from 'vitest';

import {
  normalizeDerivedState,
  normalizeGraphDependencies,
  normalizeGraphInputs,
  normalizeGraphOutputs,
  normalizeSharedState,
} from '../../src/scenes/scene-normalization';

describe('scene definition normalization', () => {
  it('normalizes graph inputs and applies adapter-specific filtering', () => {
    const normalized = normalizeGraphInputs('growth-calculator', [
      {
        optionKey: ' weeklyRevenue0 ',
        storeKey: ' seedRevenue ',
      },
      {
        optionKey: 'unknown-option',
        storeKey: 'seedRevenue',
      },
      {
        optionKey: '',
        storeKey: 'seedRevenue',
      },
    ]);

    expect(normalized).toEqual([
      {
        optionKey: 'weeklyRevenue0',
        storeKey: 'seedRevenue',
      },
    ]);
  });

  it('normalizes graph outputs and applies adapter-specific filtering', () => {
    const normalized = normalizeGraphOutputs('growth-calculator', [
      {
        outputKey: ' weeklyRevenue0 ',
        storeKey: ' revenueOut ',
      },
      {
        outputKey: 'graph-id',
      },
      {
        outputKey: 'unsupported-output',
      },
    ]);

    expect(normalized).toEqual([
      {
        outputKey: 'weeklyRevenue0',
        storeKey: 'revenueOut',
        event: 'graph:output',
      },
      {
        outputKey: 'graph-id',
        storeKey: undefined,
        event: 'graph:output',
      },
    ]);
  });

  it('normalizes dependencies and defaults events', () => {
    const normalized = normalizeGraphDependencies([
      {
        source: {
          graphId: ' source-graph ',
        },
      },
      {
        source: {
          selector: ' .source ',
        },
        outputKey: 'weeklyRevenue0',
        event: 'graph:output',
      },
      {
        source: {},
      },
    ]);

    expect(normalized).toEqual([
      {
        source: {
          graphId: 'source-graph',
          selector: undefined,
        },
        event: 'graph:ready',
        outputKey: undefined,
      },
      {
        source: {
          graphId: undefined,
          selector: '.source',
        },
        event: 'graph:output',
        outputKey: 'weeklyRevenue0',
      },
    ]);
  });

  it('normalizes shared and derived scene state', () => {
    const shared = normalizeSharedState({
      baseRevenue: 120,
    });

    const derived = normalizeDerivedState([
      {
        key: ' derivedRevenue ',
        dependsOn: ['baseRevenue'],
        derive: (state) => Number(state.baseRevenue || 0) * 2,
      },
      {
        key: '',
        dependsOn: ['baseRevenue'],
        derive: (state) => Number(state.baseRevenue || 0),
      },
    ]);

    expect(shared).toEqual({ baseRevenue: 120 });
    expect(derived.length).toBe(1);
    expect(derived[0]?.key).toBe('derivedRevenue');
    expect(derived[0]?.derive({ baseRevenue: 50 })).toBe(100);
  });
});
