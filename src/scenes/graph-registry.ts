import type { GraphId, GraphInstance, GraphRegistry } from '../core/contracts';

export class InMemoryGraphRegistry implements GraphRegistry {
  private readonly byId = new Map<GraphId, GraphInstance>();
  private byMount = new WeakMap<Element, GraphInstance>();

  getById(graphId: GraphId): GraphInstance | null {
    return this.byId.get(graphId) || null;
  }

  getByMount(mount: Element): GraphInstance | null {
    return this.byMount.get(mount) || null;
  }

  list(): GraphInstance[] {
    return Array.from(this.byId.values());
  }

  register(instance: GraphInstance): GraphInstance {
    const existingById = this.byId.get(instance.graphId);
    existingById && this.byMount.delete(existingById.mount);

    const existingByMount = this.byMount.get(instance.mount);
    existingByMount && this.byId.delete(existingByMount.graphId);

    this.byId.set(instance.graphId, instance);
    this.byMount.set(instance.mount, instance);
    return instance;
  }

  removeById(graphId: GraphId): boolean {
    const existing = this.byId.get(graphId);
    if (!existing) {
      return false;
    }

    this.byMount.delete(existing.mount);
    return this.byId.delete(graphId);
  }

  clear(): void {
    this.byId.clear();
    this.byMount = new WeakMap<Element, GraphInstance>();
  }
}
