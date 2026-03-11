import { describe, expect, it, vi } from 'vitest';

import type { SceneDerivedValueDefinition } from '../../src/core/contracts';
import { InMemorySceneStore } from '../../src/scenes/scene-store';

describe('scene shared store', () => {
  it('sets values, snapshots state, and skips unchanged writes', () => {
    const store = new InMemorySceneStore();
    const listener = vi.fn();
    store.subscribe(listener);

    store.set('revenue', 120);
    store.set('revenue', 120);

    expect(store.get('revenue')).toBe(120);
    expect(store.snapshot()).toEqual({ revenue: 120 });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]?.[0]).toMatchObject({
      key: 'revenue',
      value: 120,
      derived: false,
    });
  });

  it('recomputes derived state over dependency chains', () => {
    const derivedState: SceneDerivedValueDefinition[] = [
      {
        key: 'doubleBase',
        dependsOn: ['base'],
        derive: (state) => Number(state.base || 0) * 2,
      },
      {
        key: 'quadBase',
        dependsOn: ['doubleBase'],
        derive: (state) => Number(state.doubleBase || 0) * 2,
      },
    ];

    const store = new InMemorySceneStore({ base: 2 }, derivedState);
    expect(store.snapshot()).toEqual({
      base: 2,
      doubleBase: 4,
      quadBase: 8,
    });

    const events: Array<{ key: string; derived: boolean }> = [];
    store.subscribe((event) => {
      events.push({ key: event.key, derived: event.derived });
    });

    store.set('base', 3, 'graph-source');

    expect(store.snapshot()).toEqual({
      base: 3,
      doubleBase: 6,
      quadBase: 12,
    });
    expect(events).toContainEqual({ key: 'base', derived: false });
    expect(events).toContainEqual({ key: 'doubleBase', derived: true });
    expect(events).toContainEqual({ key: 'quadBase', derived: true });
  });

  it('ignores malformed derived state and supports unsubscribe', () => {
    const malformed = [
      {
        key: '',
        dependsOn: ['base'],
        derive: () => 1,
      },
      {
        key: 'valid',
        dependsOn: [],
        derive: () => 2,
      },
    ] as unknown as SceneDerivedValueDefinition[];

    const store = new InMemorySceneStore({ base: 1 }, malformed);
    expect(store.snapshot()).toEqual({ base: 1 });

    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    store.set('base', 2);
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    store.set('base', 3);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
