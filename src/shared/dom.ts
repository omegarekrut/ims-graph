import {
  DATA_GRAPH_SELECTOR,
  DEFAULT_GRAPH_SELECTOR
} from '../core/defaults';
import type { GraphMountTarget } from '../core/contracts';

export function resolveElement(target: GraphMountTarget, root: ParentNode = document): Element | null {
  if (typeof target !== 'string') {
    return target;
  }
  return root.querySelector(target);
}

export function uniqueElements(elements: Element[]): Element[] {
  const seen = new Set<Element>();
  const unique: Element[] = [];

  elements.forEach((el) => {
    if (seen.has(el)) {
      return;
    }
    seen.add(el);
    unique.push(el);
  });

  return unique;
}

export function discoverGraphMounts(root: ParentNode = document): Element[] {
  const queryRoot = root as Document | Element;
  const legacyMounts = Array.from(queryRoot.querySelectorAll(DEFAULT_GRAPH_SELECTOR));
  const dataMounts = Array.from(queryRoot.querySelectorAll(DATA_GRAPH_SELECTOR));
  return uniqueElements([...legacyMounts, ...dataMounts]);
}

export function discoverSceneMounts(root: ParentNode = document): Element[] {
  const queryRoot = root as Document | Element;
  return Array.from(queryRoot.querySelectorAll('[data-ims-scene]'));
}

export function isElementInContainer(target: Element, container: Element): boolean {
  return target === container || container.contains(target);
}
