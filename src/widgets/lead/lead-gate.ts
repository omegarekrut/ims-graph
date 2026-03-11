import type { GraphId, GrowthCalculatorOptions } from '../../core/contracts';
import { readCanonicalGrowthSnapshotFromLegacyInstance } from './growth-snapshot';
import {
  readCalculatorSnapshot,
  readLeadSubmitted,
  recordModalClosed,
  recordModalShown,
  recordModalSubmitSuccess,
  resolveLeadGatePageScope,
  writeCalculatorSnapshot,
} from './lead-storage';

const MODAL_SELECTOR = '.calc_modal';
const MODAL_CLOSE_SELECTOR = '.calc_modal-close';
const MODAL_SUCCESS_SELECTOR = '.w-form-done';
const GRAPH_MOUNT_SELECTOR = '[data-ims-graph], #ims-growth-calc';
const LEAD_GATE_INTERACTION_THRESHOLD = 3;

interface LeadGateInteractionSnapshot {
  weeklyRevenue0: number;
  weeklyGrowthRate: number;
  grossMargin: number;
  weeklyFixedExpenses: number;
}

interface LeadGateLegacyInteractionBindings {
  inputs: HTMLInputElement[];
  svg: SVGSVGElement;
}

export interface LeadGateModalElements {
  modal: HTMLElement | null;
  closeButton: HTMLElement | null;
  successState: HTMLElement | null;
}

export interface LeadGateMountRegistration {
  graphId: GraphId | null;
  pageScope: string;
  mountIdentity: string | null;
  registrationKey: string | null;
}

export interface LeadGateSnapshotRestoreCandidate {
  snapshot: GrowthCalculatorOptions | null;
  commit(): void;
}

const NOOP_COMMIT = (): void => {};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function findElementBySelector(root: ParentNode, selector: string): HTMLElement | null {
  try {
    const node = root.querySelector(selector);
    return node instanceof HTMLElement ? node : null;
  } catch {
    return null;
  }
}

function findElementsBySelector(root: ParentNode, selector: string): HTMLElement[] {
  try {
    return Array.from(root.querySelectorAll(selector)).filter(
      (node): node is HTMLElement => node instanceof HTMLElement
    );
  } catch {
    return [];
  }
}

function isHtmlInputElement(value: unknown): value is HTMLInputElement {
  return value instanceof HTMLInputElement;
}

function isSvgElement(value: unknown): value is SVGSVGElement {
  return value instanceof SVGSVGElement;
}

function isElementEffectivelyVisible(element: HTMLElement): boolean {
  if (!element.isConnected) {
    return false;
  }

  let cursor: HTMLElement | null = element;
  while (cursor) {
    if (cursor.hidden) {
      return false;
    }
    if (cursor.getAttribute('aria-hidden') === 'true') {
      return false;
    }

    const style = window.getComputedStyle(cursor);
    if (
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      style.visibility === 'collapse'
    ) {
      return false;
    }

    cursor = cursor.parentElement;
  }

  return true;
}

function hasVisibleSuccessState(nodes: HTMLElement[]): boolean {
  return nodes.some((node) => isElementEffectivelyVisible(node));
}

function resolveLegacyInteractionBindings(
  legacyInstance: unknown
): LeadGateLegacyInteractionBindings | null {
  if (!isRecord(legacyInstance)) {
    return null;
  }

  const nodes = legacyInstance.nodes;
  if (!isRecord(nodes)) {
    return null;
  }

  const inputs = [
    nodes.inputRevenue,
    nodes.inputGrossMargin,
    nodes.inputFixed,
    nodes.inputGrowth,
  ].filter(isHtmlInputElement);
  const svg = isSvgElement(nodes.svg) ? nodes.svg : null;

  if (!svg || !inputs.length) {
    return null;
  }

  return {
    inputs,
    svg,
  };
}

function readInteractionSnapshot(legacyInstance: unknown): LeadGateInteractionSnapshot | null {
  const snapshot = readCanonicalGrowthSnapshotFromLegacyInstance(legacyInstance);
  if (!snapshot) {
    return null;
  }

  const weeklyRevenue0 = snapshot.weeklyRevenue0;
  const weeklyGrowthRate = snapshot.weeklyGrowthRate;
  const grossMargin = snapshot.grossMargin;
  const weeklyFixedExpenses = snapshot.weeklyFixedExpenses;
  const hasCompleteSnapshot =
    typeof weeklyRevenue0 === 'number' &&
    typeof weeklyGrowthRate === 'number' &&
    typeof grossMargin === 'number' &&
    typeof weeklyFixedExpenses === 'number';
  if (!hasCompleteSnapshot) {
    return null;
  }

  return {
    weeklyRevenue0,
    weeklyGrowthRate,
    grossMargin,
    weeklyFixedExpenses,
  };
}

function hasInteractionDelta(
  before: LeadGateInteractionSnapshot | null,
  after: LeadGateInteractionSnapshot | null
): boolean {
  if (!before || !after) {
    return false;
  }

  return (
    before.weeklyRevenue0 !== after.weeklyRevenue0 ||
    before.weeklyGrowthRate !== after.weeklyGrowthRate ||
    before.grossMargin !== after.grossMargin ||
    before.weeklyFixedExpenses !== after.weeklyFixedExpenses
  );
}

function sanitizeIdentitySegment(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/-+/g, '-');
  return normalized.replace(/^-+/, '').replace(/-+$/, '');
}

function isSingleKnownGraphMount(root: ParentNode, mount: Element): boolean {
  try {
    const candidates = Array.from(root.querySelectorAll(GRAPH_MOUNT_SELECTOR));
    return candidates.length === 1 && candidates[0] === mount;
  } catch {
    return false;
  }
}

export function resolveLeadGateMountIdentity(
  mount: Element,
  root: ParentNode = document
): string | null {
  const graphMarker = mount.getAttribute('data-ims-graph');
  if (typeof graphMarker === 'string' && graphMarker.trim() !== '') {
    return `graph:${sanitizeIdentitySegment(graphMarker)}`;
  }

  if (mount.id.trim() !== '') {
    return `id:${sanitizeIdentitySegment(mount.id)}`;
  }

  if (isSingleKnownGraphMount(root, mount)) {
    return 'single:mount';
  }

  return null;
}

export class PageLeadGateController {
  private readonly root: Document;
  private modalElements: LeadGateModalElements = {
    modal: null,
    closeButton: null,
    successState: null,
  };
  private submitSuccessObserver: MutationObserver | null = null;
  private observedSuccessRoot: HTMLElement | null = null;
  private closeButtonBinding: HTMLElement | null = null;
  private readonly registrationsByMount = new Map<Element, LeadGateMountRegistration>();
  private readonly registrationsByKey = new Map<string, Element>();
  private restoredSnapshotKeys = new Set<string>();
  private readonly interactionCleanupByMount = new Map<Element, () => void>();
  private readonly legacyInstanceByMount = new Map<Element, unknown>();
  private qualifyingInteractionCount = 0;
  private hasPersistedSubmitSuccess = false;

  constructor(root: Document) {
    this.root = root;
    this.hasPersistedSubmitSuccess = readLeadSubmitted();
    this.refreshModalElements();
  }

  isBoundTo(root: Document): boolean {
    return this.root === root;
  }

  getModalElements(): LeadGateModalElements {
    this.refreshModalElements();
    return { ...this.modalElements };
  }

  refreshModalElements(): LeadGateModalElements {
    const modal = findElementBySelector(this.root, MODAL_SELECTOR);
    const closeButton = modal ? findElementBySelector(modal, MODAL_CLOSE_SELECTOR) : null;
    const successState = modal ? findElementBySelector(modal, MODAL_SUCCESS_SELECTOR) : null;

    if (this.closeButtonBinding && this.closeButtonBinding !== closeButton) {
      this.closeButtonBinding.removeEventListener('click', this.onCloseClick);
      this.closeButtonBinding = null;
    }

    if (closeButton && this.closeButtonBinding !== closeButton) {
      closeButton.addEventListener('click', this.onCloseClick);
      this.closeButtonBinding = closeButton;
    }

    this.modalElements = {
      modal,
      closeButton,
      successState,
    };
    this.ensureSubmitSuccessObserver();
    this.maybePersistSubmitSuccess();

    return this.modalElements;
  }

  registerCalculatorMount(
    mount: Element,
    graphId: GraphId | null = null
  ): LeadGateMountRegistration {
    this.refreshModalElements();

    const pageScope = resolveLeadGatePageScope();
    const mountIdentity = resolveLeadGateMountIdentity(mount, this.root);
    const registrationKey = mountIdentity ? `${pageScope}::${mountIdentity}` : null;

    const registration: LeadGateMountRegistration = {
      graphId,
      pageScope,
      mountIdentity,
      registrationKey,
    };

    this.reconcileMountRegistrationIntent(mount, registration);
    this.registrationsByMount.set(mount, registration);
    return registration;
  }

  readSnapshotRestoreCandidateForMount(mount: Element): LeadGateSnapshotRestoreCandidate {
    const registration =
      this.registrationsByMount.get(mount) || this.registerCalculatorMount(mount);
    if (!registration.mountIdentity) {
      return {
        snapshot: null,
        commit: NOOP_COMMIT,
      };
    }

    const restoreKey = `${registration.pageScope}::${registration.mountIdentity}`;
    if (this.restoredSnapshotKeys.has(restoreKey)) {
      return {
        snapshot: null,
        commit: NOOP_COMMIT,
      };
    }

    const snapshot = readCalculatorSnapshot(registration.pageScope, registration.mountIdentity);
    if (!snapshot) {
      let committed = false;
      return {
        snapshot: null,
        commit: () => {
          if (committed) {
            return;
          }
          committed = true;
          this.restoredSnapshotKeys.add(restoreKey);
        },
      };
    }

    let committed = false;
    return {
      snapshot,
      commit: () => {
        if (committed) {
          return;
        }
        committed = true;
        this.restoredSnapshotKeys.add(restoreKey);
      },
    };
  }

  writeSnapshotForMount(mount: Element, snapshot: GrowthCalculatorOptions): void {
    const registration =
      this.registrationsByMount.get(mount) || this.registerCalculatorMount(mount);
    if (!registration.mountIdentity) {
      return;
    }
    writeCalculatorSnapshot(registration.pageScope, registration.mountIdentity, snapshot);
  }

  registerCalculatorInstance(mount: Element, legacyInstance: unknown): void {
    this.unregisterCalculatorInstance(mount);
    this.legacyInstanceByMount.set(mount, legacyInstance);
    const registration =
      this.registrationsByMount.get(mount) || this.registerCalculatorMount(mount);
    this.activateMountRegistration(mount, registration);
    const bindings = resolveLegacyInteractionBindings(legacyInstance);
    if (!bindings) {
      this.maybePersistSubmitSuccess();
      return;
    }

    let pendingInputBaseline: LeadGateInteractionSnapshot | null = null;
    let pendingDragBaseline: LeadGateInteractionSnapshot | null = null;

    const beginInputSession = (): void => {
      pendingInputBaseline = readInteractionSnapshot(legacyInstance);
    };

    const onInputFocus = (): void => {
      beginInputSession();
    };

    const onInputKeydown = (event: Event): void => {
      const keyboardEvent = event as KeyboardEvent;
      if (keyboardEvent.key !== 'Enter') {
        return;
      }
      if (!pendingInputBaseline) {
        beginInputSession();
      }
    };

    const onInputBlur = (): void => {
      const before = pendingInputBaseline;
      pendingInputBaseline = null;
      if (!before) {
        return;
      }
      const after = readInteractionSnapshot(legacyInstance);
      this.recordQualifyingInteraction(before, after);
    };

    const onSvgPointerDown = (event: Event): void => {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }

      const handle = target.getAttribute('data-handle');
      if (typeof handle !== 'string' || handle.trim() === '') {
        return;
      }

      pendingDragBaseline = readInteractionSnapshot(legacyInstance);
    };

    const onSvgPointerUp = (): void => {
      const before = pendingDragBaseline;
      pendingDragBaseline = null;
      if (!before) {
        return;
      }
      const after = readInteractionSnapshot(legacyInstance);
      this.recordQualifyingInteraction(before, after);
    };

    const onSvgPointerCancel = (): void => {
      pendingDragBaseline = null;
    };

    bindings.inputs.forEach((input) => {
      input.addEventListener('focus', onInputFocus);
      input.addEventListener('keydown', onInputKeydown);
      input.addEventListener('blur', onInputBlur);
    });
    bindings.svg.addEventListener('pointerdown', onSvgPointerDown);
    bindings.svg.addEventListener('pointerup', onSvgPointerUp);
    bindings.svg.addEventListener('pointercancel', onSvgPointerCancel);

    this.interactionCleanupByMount.set(mount, () => {
      bindings.inputs.forEach((input) => {
        input.removeEventListener('focus', onInputFocus);
        input.removeEventListener('keydown', onInputKeydown);
        input.removeEventListener('blur', onInputBlur);
      });
      bindings.svg.removeEventListener('pointerdown', onSvgPointerDown);
      bindings.svg.removeEventListener('pointerup', onSvgPointerUp);
      bindings.svg.removeEventListener('pointercancel', onSvgPointerCancel);
    });
    this.maybePersistSubmitSuccess();
  }

  isLeadSubmitted(): boolean {
    return readLeadSubmitted();
  }

  openModal(): boolean {
    const { modal } = this.refreshModalElements();
    if (!modal) {
      return false;
    }
    if (modal.classList.contains('show')) {
      return false;
    }

    modal.classList.add('show');
    recordModalShown();
    return true;
  }

  closeModal(): boolean {
    const { modal } = this.refreshModalElements();
    if (!modal) {
      return false;
    }
    if (!modal.classList.contains('show')) {
      return false;
    }

    modal.classList.remove('show');
    recordModalClosed();
    return true;
  }

  dispose(): void {
    if (this.closeButtonBinding) {
      this.closeButtonBinding.removeEventListener('click', this.onCloseClick);
      this.closeButtonBinding = null;
    }
    this.interactionCleanupByMount.forEach((cleanup) => {
      cleanup();
    });
    this.interactionCleanupByMount.clear();
    this.registrationsByMount.clear();
    this.registrationsByKey.clear();
    this.legacyInstanceByMount.clear();
    this.restoredSnapshotKeys.clear();
    this.qualifyingInteractionCount = 0;
    this.hasPersistedSubmitSuccess = false;
    this.disconnectSubmitSuccessObserver();
    this.modalElements = {
      modal: null,
      closeButton: null,
      successState: null,
    };
  }

  private recordQualifyingInteraction(
    before: LeadGateInteractionSnapshot | null,
    after: LeadGateInteractionSnapshot | null
  ): void {
    if (this.isLeadSubmitted()) {
      return;
    }
    if (!hasInteractionDelta(before, after)) {
      return;
    }

    this.qualifyingInteractionCount += 1;
    if (this.qualifyingInteractionCount === LEAD_GATE_INTERACTION_THRESHOLD) {
      this.openModal();
    }
  }

  private unregisterCalculatorInstance(mount: Element): void {
    const registration = this.registrationsByMount.get(mount);
    if (
      registration?.registrationKey &&
      this.registrationsByKey.get(registration.registrationKey) === mount
    ) {
      this.registrationsByKey.delete(registration.registrationKey);
    }

    const cleanup = this.interactionCleanupByMount.get(mount);
    if (!cleanup) {
      this.legacyInstanceByMount.delete(mount);
      return;
    }
    cleanup();
    this.interactionCleanupByMount.delete(mount);
    this.legacyInstanceByMount.delete(mount);
  }

  private reconcileMountRegistrationIntent(
    mount: Element,
    registration: LeadGateMountRegistration
  ): void {
    const existingByMount = this.registrationsByMount.get(mount);
    if (
      existingByMount?.registrationKey &&
      this.registrationsByKey.get(existingByMount.registrationKey) === mount &&
      existingByMount.registrationKey !== registration.registrationKey
    ) {
      this.registrationsByKey.delete(existingByMount.registrationKey);
    }
  }

  private activateMountRegistration(mount: Element, registration: LeadGateMountRegistration): void {
    if (!registration.registrationKey) {
      return;
    }

    const existingMountForKey = this.registrationsByKey.get(registration.registrationKey);
    if (existingMountForKey && existingMountForKey !== mount) {
      this.unregisterCalculatorInstance(existingMountForKey);
      this.registrationsByMount.delete(existingMountForKey);
    }

    this.registrationsByKey.set(registration.registrationKey, mount);
  }

  private ensureSubmitSuccessObserver(): void {
    if (typeof MutationObserver === 'undefined') {
      return;
    }

    const successRoot = this.modalElements.modal;
    if (this.observedSuccessRoot === successRoot) {
      return;
    }

    this.disconnectSubmitSuccessObserver();

    if (!successRoot || this.hasPersistedSubmitSuccess) {
      return;
    }

    const observer = new MutationObserver(() => {
      this.refreshModalSuccessState();
      this.maybePersistSubmitSuccess();
    });
    observer.observe(successRoot, {
      attributes: true,
      childList: true,
      subtree: true,
      attributeFilter: ['class', 'style', 'hidden', 'aria-hidden'],
    });
    this.submitSuccessObserver = observer;
    this.observedSuccessRoot = successRoot;
  }

  private disconnectSubmitSuccessObserver(): void {
    this.submitSuccessObserver?.disconnect();
    this.submitSuccessObserver = null;
    this.observedSuccessRoot = null;
  }

  private maybePersistSubmitSuccess(): void {
    if (this.hasPersistedSubmitSuccess) {
      return;
    }
    if (readLeadSubmitted()) {
      this.hasPersistedSubmitSuccess = true;
      this.disconnectSubmitSuccessObserver();
      return;
    }
    if (!this.legacyInstanceByMount.size) {
      return;
    }
    const successStates = this.refreshModalSuccessState();
    if (!hasVisibleSuccessState(successStates)) {
      return;
    }

    this.legacyInstanceByMount.forEach((legacyInstance, mount) => {
      const snapshot = readCanonicalGrowthSnapshotFromLegacyInstance(legacyInstance);
      if (!snapshot) {
        return;
      }
      this.writeSnapshotForMount(mount, snapshot);
    });

    recordModalSubmitSuccess();
    this.hasPersistedSubmitSuccess = true;
    this.disconnectSubmitSuccessObserver();
  }

  private refreshModalSuccessState(): HTMLElement[] {
    const successStates = this.modalElements.modal
      ? findElementsBySelector(this.modalElements.modal, MODAL_SUCCESS_SELECTOR)
      : [];
    const successState = successStates[0] || null;
    this.modalElements = {
      ...this.modalElements,
      successState,
    };
    return successStates;
  }

  private readonly onCloseClick = (): void => {
    this.closeModal();
  };
}

let pageLeadGateController: PageLeadGateController | null = null;

export function getPageLeadGateController(): PageLeadGateController | null {
  if (typeof document === 'undefined') {
    return null;
  }

  if (pageLeadGateController?.isBoundTo(document)) {
    return pageLeadGateController;
  }

  pageLeadGateController?.dispose();
  pageLeadGateController = new PageLeadGateController(document);
  return pageLeadGateController;
}

export function resetPageLeadGateController(): void {
  pageLeadGateController?.dispose();
  pageLeadGateController = null;
}
