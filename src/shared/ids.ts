import type { GraphId, SceneId } from '../core/contracts';

let graphSeq = 0;
let sceneSeq = 0;

export function createGraphId(prefix: string = 'ims-graph'): GraphId {
  graphSeq += 1;
  return `${prefix}-${graphSeq}`;
}

export function createSceneId(prefix: string = 'ims-scene'): SceneId {
  sceneSeq += 1;
  return `${prefix}-${sceneSeq}`;
}

export function toGraphId(value: string | null | undefined): GraphId | null {
  if (typeof value !== 'string' || value.trim() === '') {
    return null;
  }
  return value.trim();
}

export function toSceneId(value: string | null | undefined): SceneId | null {
  if (typeof value !== 'string' || value.trim() === '') {
    return null;
  }
  return value.trim();
}
