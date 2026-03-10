import { describe, expect, it } from 'vitest';

import type {
  GraphDependency,
  GraphInputBinding
} from '../../src/core/contracts';
import {
  createDependencyIndex,
  createStoreInputIndex,
  orderSceneGraphsByDependencies
} from '../../src/scenes/scene-dependency-graph';
import type { ResolvedGraphDefinition } from '../../src/scenes/scene-normalization';

function createGraphDefinition(
  graphId: string,
  dependsOn: GraphDependency[] = [],
  inputs: GraphInputBinding[] = [],
  className?: string
): ResolvedGraphDefinition {
  const mount = document.createElement('div');
  if (className) {
    mount.className = className;
  }

  return {
    graphId,
    kind: 'growth-calculator',
    mount,
    options: {},
    inputs,
    outputs: [],
    dependsOn
  };
}

describe('scene dependency graph helpers', () => {
  it('orders graphs according to graph-id dependencies', () => {
    const source = createGraphDefinition('source');
    const target = createGraphDefinition('target', [
      {
        source: { graphId: 'source' },
        event: 'graph:ready'
      }
    ]);

    const ordered = orderSceneGraphsByDependencies([target, source]);
    expect(ordered.map((entry) => entry.graphId)).toEqual(['source', 'target']);
  });

  it('resolves selector dependencies in the dependency index', () => {
    const source = createGraphDefinition('source', [], [], 'source-graph');
    const target = createGraphDefinition('target', [
      {
        source: { selector: '.source-graph' },
        event: 'graph:output',
        outputKey: 'weeklyRevenue0'
      }
    ]);

    const index = createDependencyIndex([source, target]);
    expect(index.get('source')).toEqual([
      {
        sourceGraphId: 'source',
        targetGraphId: 'target',
        event: 'graph:output',
        outputKey: 'weeklyRevenue0'
      }
    ]);
  });

  it('returns unresolved cyclic graphs after topological ordering', () => {
    const graphA = createGraphDefinition('graph-a', [
      {
        source: { graphId: 'graph-b' },
        event: 'graph:ready'
      }
    ]);
    const graphB = createGraphDefinition('graph-b', [
      {
        source: { graphId: 'graph-a' },
        event: 'graph:ready'
      }
    ]);

    const ordered = orderSceneGraphsByDependencies([graphA, graphB]);
    expect(ordered.map((entry) => entry.graphId)).toEqual(['graph-a', 'graph-b']);
  });

  it('indexes store input bindings by store key', () => {
    const graphA = createGraphDefinition('graph-a', [], [
      {
        optionKey: 'weeklyRevenue0',
        storeKey: 'sharedRevenue'
      }
    ]);
    const graphB = createGraphDefinition('graph-b', [], [
      {
        optionKey: 'weeklyRevenue0',
        storeKey: 'sharedRevenue'
      },
      {
        optionKey: 'weeklyFixedExpenses',
        storeKey: 'sharedFixed'
      }
    ]);

    const index = createStoreInputIndex([graphA, graphB]);
    expect(Array.from(index.get('sharedRevenue') || [])).toEqual(['graph-a', 'graph-b']);
    expect(Array.from(index.get('sharedFixed') || [])).toEqual(['graph-b']);
  });
});
