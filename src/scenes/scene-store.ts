import type {
  GraphId,
  SceneDerivedValueDefinition,
  SceneSharedStore,
  SceneStoreChangeEvent,
} from '../core/contracts';

const MAX_DERIVED_PASSES = 8;

type StoreListener = (event: SceneStoreChangeEvent) => void;

function hasDependencyChange(dependsOn: string[], changedKeys: Set<string>): boolean {
  return dependsOn.some((key) => changedKeys.has(key));
}

function shallowCloneState(state: Map<string, unknown>): Record<string, unknown> {
  const snapshot: Record<string, unknown> = {};
  state.forEach((value, key) => {
    snapshot[key] = value;
  });
  return snapshot;
}

function normalizeDerivedState(
  derivedState: SceneDerivedValueDefinition[] | undefined
): SceneDerivedValueDefinition[] {
  if (!derivedState || !derivedState.length) {
    return [];
  }

  return derivedState.filter((item) => {
    if (typeof item?.key !== 'string' || item.key.trim() === '') {
      return false;
    }
    if (!Array.isArray(item.dependsOn) || !item.dependsOn.length) {
      return false;
    }
    return typeof item.derive === 'function';
  });
}

export class InMemorySceneStore implements SceneSharedStore {
  private readonly state = new Map<string, unknown>();
  private readonly derivedState: SceneDerivedValueDefinition[];
  private readonly listeners = new Set<StoreListener>();

  constructor(
    initialState: Record<string, unknown> = {},
    derivedState: SceneDerivedValueDefinition[] = []
  ) {
    this.derivedState = normalizeDerivedState(derivedState);
    this.setMany(initialState, null);
  }

  get(key: string): unknown {
    return this.state.get(key);
  }

  set(key: string, value: unknown, sourceGraphId: GraphId | null = null): void {
    this.setMany({ [key]: value }, sourceGraphId);
  }

  setMany(values: Record<string, unknown>, sourceGraphId: GraphId | null = null): void {
    const changedKeys = new Set<string>();

    Object.entries(values).forEach(([key, value]) => {
      const previousValue = this.state.get(key);
      if (Object.is(previousValue, value)) {
        return;
      }

      this.state.set(key, value);
      changedKeys.add(key);
      this.emit({
        type: 'store:updated',
        key,
        value,
        previousValue,
        sourceGraphId,
        derived: false,
        snapshot: this.snapshot(),
      });
    });

    changedKeys.size && this.recomputeDerived(changedKeys, sourceGraphId);
  }

  snapshot(): Record<string, unknown> {
    return shallowCloneState(this.state);
  }

  subscribe(listener: StoreListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private recomputeDerived(changedKeys: Set<string>, sourceGraphId: GraphId | null): void {
    if (!this.derivedState.length) {
      return;
    }

    let pass = 0;
    let pendingKeys = new Set<string>(changedKeys);

    while (pendingKeys.size && pass < MAX_DERIVED_PASSES) {
      const nextPending = new Set<string>();
      const snapshot = this.snapshot();

      this.derivedState.forEach((entry) => {
        if (!hasDependencyChange(entry.dependsOn, pendingKeys)) {
          return;
        }

        const previousValue = this.state.get(entry.key);
        const nextValue = entry.derive(snapshot);
        if (Object.is(previousValue, nextValue)) {
          return;
        }

        this.state.set(entry.key, nextValue);
        nextPending.add(entry.key);
        this.emit({
          type: 'store:updated',
          key: entry.key,
          value: nextValue,
          previousValue,
          sourceGraphId,
          derived: true,
          snapshot: this.snapshot(),
        });
      });

      pendingKeys = nextPending;
      pass += 1;
    }
  }

  private emit(event: SceneStoreChangeEvent): void {
    this.listeners.forEach((listener) => {
      listener(event);
    });
  }
}
