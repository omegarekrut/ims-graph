import { describe, expect, it } from 'vitest';

import type { GraphInstance } from '../../src/core/contracts';
import { InMemoryGraphRegistry } from '../../src/scenes/graph-registry';

function createGraphInstance(graphId: string, mount: Element): GraphInstance {
  return {
    graphId,
    kind: 'growth-calculator',
    mount,
    options: {},
    legacyInstance: null,
    inputs: [],
    outputs: [],
    dependsOn: [],
    sceneId: null,
    createdAtMs: Date.now(),
  };
}

describe('in-memory graph registry', () => {
  it('registers and resolves graph instances by id and mount', () => {
    const registry = new InMemoryGraphRegistry();
    const mount = document.createElement('div');
    const graph = createGraphInstance('graph-a', mount);

    registry.register(graph);

    expect(registry.getById('graph-a')).toBe(graph);
    expect(registry.getByMount(mount)).toBe(graph);
    expect(registry.list()).toEqual([graph]);
  });

  it('replaces stale mount mapping when a graph id is re-registered', () => {
    const registry = new InMemoryGraphRegistry();
    const oldMount = document.createElement('div');
    const newMount = document.createElement('div');

    const first = createGraphInstance('graph-a', oldMount);
    const second = createGraphInstance('graph-a', newMount);

    registry.register(first);
    registry.register(second);

    expect(registry.getById('graph-a')).toBe(second);
    expect(registry.getByMount(oldMount)).toBeNull();
    expect(registry.getByMount(newMount)).toBe(second);
  });

  it('replaces stale id mapping when a mount is re-registered', () => {
    const registry = new InMemoryGraphRegistry();
    const mount = document.createElement('div');
    const first = createGraphInstance('graph-a', mount);
    const second = createGraphInstance('graph-b', mount);

    registry.register(first);
    registry.register(second);

    expect(registry.getById('graph-a')).toBeNull();
    expect(registry.getById('graph-b')).toBe(second);
    expect(registry.getByMount(mount)).toBe(second);
  });

  it('removes and clears graph entries', () => {
    const registry = new InMemoryGraphRegistry();
    const mount = document.createElement('div');
    const graph = createGraphInstance('graph-a', mount);
    registry.register(graph);

    expect(registry.removeById('graph-a')).toBe(true);
    expect(registry.removeById('graph-a')).toBe(false);
    expect(registry.getById('graph-a')).toBeNull();
    expect(registry.getByMount(mount)).toBeNull();

    registry.register(graph);
    registry.clear();
    expect(registry.list()).toEqual([]);
    expect(registry.getById('graph-a')).toBeNull();
    expect(registry.getByMount(mount)).toBeNull();
  });
});
