import type { SceneId, SceneInstance } from '../core/contracts';
import { InMemoryGraphRegistry } from './graph-registry';

const graphRegistry = new InMemoryGraphRegistry();
const sceneRegistryById = new Map<SceneId, SceneInstance>();
const sceneCleanupById = new Map<SceneId, () => void>();
let sceneRegistryByMount = new WeakMap<Element, SceneInstance>();

export function getGraphRuntimeRegistry(): InMemoryGraphRegistry {
  return graphRegistry;
}

export function getSceneById(sceneId: SceneId): SceneInstance | null {
  return sceneRegistryById.get(sceneId) || null;
}

export function getSceneByMount(mount: Element): SceneInstance | null {
  return sceneRegistryByMount.get(mount) || null;
}

export function listScenes(): SceneInstance[] {
  return Array.from(sceneRegistryById.values());
}

export function registerScene(sceneInstance: SceneInstance): void {
  sceneRegistryById.set(sceneInstance.sceneId, sceneInstance);
  sceneRegistryByMount.set(sceneInstance.mount, sceneInstance);
}

export function setSceneCleanup(sceneId: SceneId, cleanup: () => void): void {
  sceneCleanupById.set(sceneId, cleanup);
}

export function resetSceneRuntimeState(onGraphReset: () => void): void {
  graphRegistry.clear();
  onGraphReset();
  sceneRegistryById.clear();
  sceneRegistryByMount = new WeakMap<Element, SceneInstance>();

  sceneCleanupById.forEach((cleanup) => {
    cleanup();
  });
  sceneCleanupById.clear();
}
