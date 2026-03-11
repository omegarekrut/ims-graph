import { afterEach, describe, expect, it } from 'vitest';
import type { GrowthCalculatorOptions } from '../../src/core/contracts';
import {
  getPageLeadGateController,
  resetPageLeadGateController,
  resolveLeadGateMountIdentity,
} from '../../src/widgets/lead/lead-gate';
import {
  createDefaultLeadGateStoragePayload,
  LEAD_GATE_STORAGE_KEY,
  readCalculatorSnapshot,
  readLeadGateStorage,
  resolveLeadGatePageScope,
  setLeadSubmitted,
  writeCalculatorSnapshot,
  writeLeadGateStorage,
} from '../../src/widgets/lead/lead-storage';

interface FakeLegacyHarness {
  legacyInstance: {
    state: Required<GrowthCalculatorOptions>;
    nodes: {
      inputRevenue: HTMLInputElement;
      inputGrossMargin: HTMLInputElement;
      inputFixed: HTMLInputElement;
      inputGrowth: HTMLInputElement;
      svg: SVGSVGElement;
    };
  };
  state: Required<GrowthCalculatorOptions>;
  inputRevenue: HTMLInputElement;
  inputGrossMargin: HTMLInputElement;
  inputFixed: HTMLInputElement;
  inputGrowth: HTMLInputElement;
  svg: SVGSVGElement;
  handle: SVGElement;
}

interface InteractionTestContext {
  mount: Element;
  harness: FakeLegacyHarness;
  controller: NonNullable<ReturnType<typeof getPageLeadGateController>>;
  modal: HTMLElement;
}

type EditableStateKey =
  | 'weeklyRevenue0'
  | 'weeklyGrowthRate'
  | 'grossMargin'
  | 'weeklyFixedExpenses';

type HarnessInputKey = 'inputRevenue' | 'inputGrowth' | 'inputGrossMargin' | 'inputFixed';

function createFakeLegacyHarness(mount: Element): FakeLegacyHarness {
  const state: Required<GrowthCalculatorOptions> = {
    units: 'week',
    expenseViz: 'bars',
    weeklyRevenue0: 100,
    weeklyGrowthRate: 0.0353,
    grossMargin: 1,
    weeklyFixedExpenses: 1600,
    yearsMin: 1,
    yearsMax: 9,
  };

  const inputRevenue = document.createElement('input');
  const inputGrossMargin = document.createElement('input');
  const inputFixed = document.createElement('input');
  const inputGrowth = document.createElement('input');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;
  const handle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  handle.setAttribute('data-handle', 'growth');
  svg.appendChild(handle);

  mount.appendChild(inputRevenue);
  mount.appendChild(inputGrossMargin);
  mount.appendChild(inputFixed);
  mount.appendChild(inputGrowth);
  mount.appendChild(svg);

  return {
    legacyInstance: {
      state,
      nodes: {
        inputRevenue,
        inputGrossMargin,
        inputFixed,
        inputGrowth,
        svg,
      },
    },
    state,
    inputRevenue,
    inputGrossMargin,
    inputFixed,
    inputGrowth,
    svg,
    handle,
  };
}

function applyInputChange(
  harness: FakeLegacyHarness,
  inputKey: HarnessInputKey,
  stateKey: EditableStateKey,
  nextValue: number
): void {
  harness[inputKey].dispatchEvent(new Event('focus'));
  harness.state[stateKey] = nextValue;
  harness[inputKey].dispatchEvent(new Event('blur'));
}

function seedTwoQualifyingInteractions(harness: FakeLegacyHarness): void {
  applyInputChange(harness, 'inputRevenue', 'weeklyRevenue0', 200);
  applyInputChange(harness, 'inputGrowth', 'weeklyGrowthRate', 0.05);
}

async function flushMutationObserverQueue(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function setupInteractionTestContext(graphId = 'graph-a'): InteractionTestContext {
  document.body.innerHTML = `
      <div class="calc_modal"></div>
      <div data-ims-graph="${graphId}"></div>
    `;

  const mountNode = document.querySelector('[data-ims-graph]');
  const modalNode = document.querySelector('.calc_modal');
  const controller = getPageLeadGateController();
  if (!(mountNode instanceof Element) || !(modalNode instanceof HTMLElement) || !controller) {
    throw new Error('Failed to create interaction test context');
  }
  const mount: Element = mountNode;
  const modal: HTMLElement = modalNode;

  const harness = createFakeLegacyHarness(mount);
  controller.registerCalculatorMount(mount, graphId);
  controller.registerCalculatorInstance(mount, harness.legacyInstance);

  return {
    mount,
    harness,
    controller,
    modal,
  };
}

function registerMountedHarness(
  controller: NonNullable<ReturnType<typeof getPageLeadGateController>>,
  mount: Element,
  graphId: string,
  harness: FakeLegacyHarness
): void {
  controller.registerCalculatorMount(mount, graphId);
  controller.registerCalculatorInstance(mount, harness.legacyInstance);
}

afterEach(() => {
  resetPageLeadGateController();
  document.body.innerHTML = '';
  window.localStorage.removeItem(LEAD_GATE_STORAGE_KEY);
});

describe('lead gate storage', () => {
  it('fails soft on malformed JSON payloads', () => {
    window.localStorage.setItem(LEAD_GATE_STORAGE_KEY, '{bad json');

    const payload = readLeadGateStorage();

    expect(payload).toEqual(createDefaultLeadGateStoragePayload());
  });

  it('fails soft when storage access is blocked', () => {
    const blockedStorage = {
      length: 0,
      clear: () => undefined,
      key: () => null,
      removeItem: () => undefined,
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    } as Storage;

    expect(() => readLeadGateStorage(blockedStorage)).not.toThrow();
    expect(() =>
      writeLeadGateStorage(createDefaultLeadGateStoragePayload(), blockedStorage)
    ).not.toThrow();
  });

  it('stores calculator snapshots by page scope and mount identity', () => {
    const pageScope = resolveLeadGatePageScope('/pricing');

    writeCalculatorSnapshot(pageScope, 'graph:revenue', {
      weeklyRevenue0: 420,
      weeklyGrowthRate: 0.12,
    });

    expect(readCalculatorSnapshot(pageScope, 'graph:revenue')?.weeklyRevenue0).toBe(420);
    expect(readCalculatorSnapshot(resolveLeadGatePageScope('/about'), 'graph:revenue')).toBeNull();
  });
});

describe('lead gate mount identity', () => {
  it('prefers data-ims-graph identity over other fallbacks', () => {
    const mount = document.createElement('div');
    mount.setAttribute('data-ims-graph', 'Revenue Graph');

    expect(resolveLeadGateMountIdentity(mount, document)).toBe('graph:revenue-graph');
  });

  it('uses element id when data-ims-graph is unavailable', () => {
    const mount = document.createElement('div');
    mount.id = 'RevenueCalcPrimary';

    expect(resolveLeadGateMountIdentity(mount, document)).toBe('id:revenuecalcprimary');
  });

  it('uses a single-mount fallback when there is exactly one known graph mount', () => {
    const mount = document.createElement('div');
    mount.setAttribute('data-ims-graph', '');
    document.body.appendChild(mount);

    expect(resolveLeadGateMountIdentity(mount, document)).toBe('single:mount');
  });

  it('returns null when multiple unkeyed graph mounts exist', () => {
    const mountA = document.createElement('div');
    mountA.setAttribute('data-ims-graph', '');

    const mountB = document.createElement('div');
    mountB.setAttribute('data-ims-graph', '');

    document.body.appendChild(mountA);
    document.body.appendChild(mountB);

    const identityA = resolveLeadGateMountIdentity(mountA, document);
    const identityB = resolveLeadGateMountIdentity(mountB, document);

    expect(identityA).toBeNull();
    expect(identityB).toBeNull();
  });
});

describe('page lead gate controller', () => {
  it('resolves modal nodes safely and wires close behavior', () => {
    document.body.innerHTML = `
      <div class="calc_modal show">
        <button class="calc_modal-close" type="button">Close</button>
        <div class="w-form-done">Success</div>
      </div>
      <div data-ims-graph="graph-a"></div>
    `;

    const mount = document.querySelector('[data-ims-graph]') as Element;
    const controller = getPageLeadGateController();

    expect(controller).not.toBeNull();
    controller?.registerCalculatorMount(mount, 'graph-a');

    const nodes = controller?.getModalElements();
    expect(nodes?.modal).not.toBeNull();
    expect(nodes?.closeButton).not.toBeNull();
    expect(nodes?.successState).not.toBeNull();

    (nodes?.closeButton as HTMLButtonElement).click();

    expect((nodes?.modal as HTMLElement).classList.contains('show')).toBe(false);
    expect(readLeadGateStorage().modal.lastClosedAtMs).not.toBeNull();
  });

  it('only records modal open/close when visibility actually changes', () => {
    document.body.innerHTML = `
      <div class="calc_modal">
        <button class="calc_modal-close" type="button">Close</button>
      </div>
    `;

    const controller = getPageLeadGateController();
    expect(controller).not.toBeNull();

    expect(controller?.openModal()).toBe(true);
    expect(controller?.openModal()).toBe(false);
    expect(readLeadGateStorage().modal.openCount).toBe(1);

    expect(controller?.closeModal()).toBe(true);
    expect(controller?.closeModal()).toBe(false);
  });

  it('skips persistence for mounts without stable identity on multi-mount pages', () => {
    document.body.innerHTML = `
      <div data-ims-graph=""></div>
      <div data-ims-graph=""></div>
    `;

    const mounts = Array.from(document.querySelectorAll('[data-ims-graph]'));
    const controller = getPageLeadGateController();

    expect(controller).not.toBeNull();
    controller?.registerCalculatorMount(mounts[0] as Element, 'graph-a');
    controller?.writeSnapshotForMount(mounts[0] as Element, { weeklyRevenue0: 777 });

    const restoreCandidate = controller?.readSnapshotRestoreCandidateForMount(mounts[0] as Element);
    expect(restoreCandidate?.snapshot).toBeNull();
    expect(Object.keys(readLeadGateStorage().pages)).toHaveLength(0);
  });

  it('does not throw when modal markup is missing', () => {
    document.body.innerHTML = '<div data-ims-graph="graph-a"></div>';

    const mount = document.querySelector('[data-ims-graph]') as Element;
    const controller = getPageLeadGateController();

    expect(() => controller?.registerCalculatorMount(mount, 'graph-a')).not.toThrow();
    expect(controller?.openModal()).toBe(false);
    expect(controller?.closeModal()).toBe(false);
  });

  it('persists submit success only when w-form-done becomes visible', async () => {
    document.body.innerHTML = `
      <div class="calc_modal show">
        <div class="w-form-done" style="display: none"></div>
      </div>
      <div data-ims-graph="graph-a"></div>
      <div data-ims-graph="graph-b"></div>
    `;

    const mounts = Array.from(document.querySelectorAll('[data-ims-graph]'));
    const successState = document.querySelector('.w-form-done') as HTMLElement;
    const modal = document.querySelector('.calc_modal') as HTMLElement;
    const controller = getPageLeadGateController();

    expect(controller).not.toBeNull();
    const harnessA = createFakeLegacyHarness(mounts[0] as Element);
    const harnessB = createFakeLegacyHarness(mounts[1] as Element);

    controller?.registerCalculatorMount(mounts[0] as Element, 'graph-a');
    controller?.registerCalculatorMount(mounts[1] as Element, 'graph-b');
    controller?.registerCalculatorInstance(mounts[0] as Element, harnessA.legacyInstance);
    controller?.registerCalculatorInstance(mounts[1] as Element, harnessB.legacyInstance);

    harnessA.state.weeklyRevenue0 = 321;
    harnessB.state.weeklyRevenue0 = 654;

    await flushMutationObserverQueue();
    expect(readLeadGateStorage().leadSubmitted).toBe(false);

    successState.style.display = 'block';
    await flushMutationObserverQueue();

    const payload = readLeadGateStorage();
    expect(payload.leadSubmitted).toBe(true);
    expect(
      readCalculatorSnapshot(resolveLeadGatePageScope('/'), 'graph:graph-a')?.weeklyRevenue0
    ).toBe(321);
    expect(
      readCalculatorSnapshot(resolveLeadGatePageScope('/'), 'graph:graph-b')?.weeklyRevenue0
    ).toBe(654);
    expect(modal.classList.contains('show')).toBe(true);
  });

  it('treats any visible success node as submit success', async () => {
    document.body.innerHTML = `
      <div class="calc_modal show">
        <div class="w-form-done" style="display: none"></div>
        <div class="w-form-done" style="display: block"></div>
      </div>
      <div data-ims-graph="graph-a"></div>
    `;

    const mount = document.querySelector('[data-ims-graph]');
    const controller = getPageLeadGateController();
    if (!mount || !controller) {
      throw new Error('Failed to initialize multi-success test context');
    }

    const harness = createFakeLegacyHarness(mount);
    harness.state.weeklyRevenue0 = 432;
    registerMountedHarness(controller, mount, 'graph-a', harness);
    await flushMutationObserverQueue();

    expect(readLeadGateStorage().leadSubmitted).toBe(true);
    expect(
      readCalculatorSnapshot(resolveLeadGatePageScope('/'), 'graph:graph-a')?.weeklyRevenue0
    ).toBe(432);
  });

  it('ignores success nodes hidden by ancestor visibility', async () => {
    document.body.innerHTML = `
      <div class="calc_modal show">
        <div class="success-wrapper" style="display: none">
          <div class="w-form-done" style="display: block"></div>
        </div>
      </div>
      <div data-ims-graph="graph-a"></div>
    `;

    const mount = document.querySelector('[data-ims-graph]');
    const wrapper = document.querySelector('.success-wrapper');
    const controller = getPageLeadGateController();
    if (!mount || !(wrapper instanceof HTMLElement) || !controller) {
      throw new Error('Failed to initialize ancestor-hidden success test context');
    }

    const harness = createFakeLegacyHarness(mount);
    harness.state.weeklyRevenue0 = 543;
    registerMountedHarness(controller, mount, 'graph-a', harness);
    await flushMutationObserverQueue();

    expect(readLeadGateStorage().leadSubmitted).toBe(false);

    wrapper.style.display = 'block';
    await flushMutationObserverQueue();

    expect(readLeadGateStorage().leadSubmitted).toBe(true);
    expect(
      readCalculatorSnapshot(resolveLeadGatePageScope('/'), 'graph:graph-a')?.weeklyRevenue0
    ).toBe(543);
  });

  it('detects success when w-form-done is inserted after controller init', async () => {
    document.body.innerHTML = `
      <div class="calc_modal show"></div>
      <div data-ims-graph="graph-a"></div>
    `;

    const mount = document.querySelector('[data-ims-graph]');
    const modal = document.querySelector('.calc_modal');
    const controller = getPageLeadGateController();

    if (!mount || !(modal instanceof HTMLElement) || !controller) {
      throw new Error('Failed to initialize inserted success test context');
    }
    const harness = createFakeLegacyHarness(mount);
    registerMountedHarness(controller, mount, 'graph-a', harness);
    harness.state.weeklyRevenue0 = 777;

    await flushMutationObserverQueue();
    expect(readLeadGateStorage().leadSubmitted).toBe(false);

    const successState = document.createElement('div');
    successState.className = 'w-form-done';
    successState.style.display = 'block';
    modal.appendChild(successState);
    await flushMutationObserverQueue();

    expect(readLeadGateStorage().leadSubmitted).toBe(true);
    expect(
      readCalculatorSnapshot(resolveLeadGatePageScope('/'), 'graph:graph-a')?.weeklyRevenue0
    ).toBe(777);
  });

  it('does not persist before instance registration when success is already visible', async () => {
    document.body.innerHTML = `
      <div class="calc_modal show">
        <div class="w-form-done" style="display: block"></div>
      </div>
      <div data-ims-graph="graph-a"></div>
    `;

    const mount = document.querySelector('[data-ims-graph]');
    const controller = getPageLeadGateController();

    if (!mount || !controller) {
      throw new Error('Failed to initialize pre-visible success test context');
    }
    await flushMutationObserverQueue();
    expect(readLeadGateStorage().leadSubmitted).toBe(false);

    const harness = createFakeLegacyHarness(mount);
    controller.registerCalculatorMount(mount, 'graph-a');
    harness.state.weeklyRevenue0 = 888;
    controller.registerCalculatorInstance(mount, harness.legacyInstance);

    expect(readLeadGateStorage().leadSubmitted).toBe(true);
    expect(
      readCalculatorSnapshot(resolveLeadGatePageScope('/'), 'graph:graph-a')?.weeklyRevenue0
    ).toBe(888);
  });

  it('replaces prior mount listeners when the same stable key is re-registered', () => {
    document.body.innerHTML = `
      <div class="calc_modal"></div>
      <div data-ims-graph="shared"></div>
      <div data-ims-graph="shared"></div>
    `;

    const mounts = Array.from(document.querySelectorAll('[data-ims-graph]'));
    const modal = document.querySelector('.calc_modal');
    const controller = getPageLeadGateController();
    if (mounts.length !== 2 || !(modal instanceof HTMLElement) || !controller) {
      throw new Error('Failed to initialize remount replacement test context');
    }

    const harnessA = createFakeLegacyHarness(mounts[0] as Element);
    const harnessB = createFakeLegacyHarness(mounts[1] as Element);

    registerMountedHarness(controller, mounts[0] as Element, 'shared', harnessA);
    registerMountedHarness(controller, mounts[1] as Element, 'shared', harnessB);

    seedTwoQualifyingInteractions(harnessA);
    applyInputChange(harnessA, 'inputFixed', 'weeklyFixedExpenses', 1700);
    expect(modal.classList.contains('show')).toBe(false);

    seedTwoQualifyingInteractions(harnessB);
    applyInputChange(harnessB, 'inputFixed', 'weeklyFixedExpenses', 1700);
    expect(modal.classList.contains('show')).toBe(true);
  });

  it('keeps existing mount active when same-key replacement intent never mounts', async () => {
    document.body.innerHTML = `
      <div class="calc_modal">
        <div class="w-form-done" style="display: none"></div>
      </div>
      <div data-ims-graph="shared"></div>
      <div data-ims-graph="shared"></div>
    `;

    const mounts = Array.from(document.querySelectorAll('[data-ims-graph]'));
    const modal = document.querySelector('.calc_modal');
    const success = document.querySelector('.w-form-done');
    const controller = getPageLeadGateController();
    if (
      mounts.length !== 2 ||
      !(modal instanceof HTMLElement) ||
      !(success instanceof HTMLElement) ||
      !controller
    ) {
      throw new Error('Failed to initialize same-key failed replacement test context');
    }

    const harnessA = createFakeLegacyHarness(mounts[0] as Element);
    registerMountedHarness(controller, mounts[0] as Element, 'shared', harnessA);

    controller.registerCalculatorMount(mounts[1] as Element, 'shared');

    seedTwoQualifyingInteractions(harnessA);
    applyInputChange(harnessA, 'inputFixed', 'weeklyFixedExpenses', 1700);
    expect(modal.classList.contains('show')).toBe(true);

    harnessA.state.weeklyRevenue0 = 919;
    success.style.display = 'block';
    await flushMutationObserverQueue();

    expect(readLeadGateStorage().leadSubmitted).toBe(true);
    expect(
      readCalculatorSnapshot(resolveLeadGatePageScope('/'), 'graph:shared')?.weeklyRevenue0
    ).toBe(919);
  });

  it('does not drop active owner when stale intent mount changes key before activation', async () => {
    document.body.innerHTML = `
      <div class="calc_modal">
        <div class="w-form-done" style="display: none"></div>
      </div>
      <div data-ims-graph="shared"></div>
      <div data-ims-graph="shared"></div>
    `;

    const mounts = Array.from(document.querySelectorAll('[data-ims-graph]'));
    const modal = document.querySelector('.calc_modal');
    const success = document.querySelector('.w-form-done');
    const controller = getPageLeadGateController();
    if (
      mounts.length !== 2 ||
      !(modal instanceof HTMLElement) ||
      !(success instanceof HTMLElement) ||
      !controller
    ) {
      throw new Error('Failed to initialize stale-intent key-change test context');
    }

    const harnessA = createFakeLegacyHarness(mounts[0] as Element);
    registerMountedHarness(controller, mounts[0] as Element, 'shared', harnessA);

    controller.registerCalculatorMount(mounts[1] as Element, 'shared');
    (mounts[1] as Element).setAttribute('data-ims-graph', 'replacement');
    controller.registerCalculatorMount(mounts[1] as Element, 'replacement');

    seedTwoQualifyingInteractions(harnessA);
    applyInputChange(harnessA, 'inputFixed', 'weeklyFixedExpenses', 1800);
    expect(modal.classList.contains('show')).toBe(true);

    harnessA.state.weeklyRevenue0 = 929;
    success.style.display = 'block';
    await flushMutationObserverQueue();

    expect(readLeadGateStorage().leadSubmitted).toBe(true);
    expect(
      readCalculatorSnapshot(resolveLeadGatePageScope('/'), 'graph:shared')?.weeklyRevenue0
    ).toBe(929);
  });

  it('persists submit snapshot from the latest mount for a shared stable key', async () => {
    document.body.innerHTML = `
      <div class="calc_modal show">
        <div class="w-form-done" style="display: none"></div>
      </div>
      <div data-ims-graph="shared"></div>
      <div data-ims-graph="shared"></div>
    `;

    const mounts = Array.from(document.querySelectorAll('[data-ims-graph]'));
    const success = document.querySelector('.w-form-done');
    const controller = getPageLeadGateController();
    if (mounts.length !== 2 || !(success instanceof HTMLElement) || !controller) {
      throw new Error('Failed to initialize shared-key submit snapshot test context');
    }

    const harnessA = createFakeLegacyHarness(mounts[0] as Element);
    const harnessB = createFakeLegacyHarness(mounts[1] as Element);
    harnessA.state.weeklyRevenue0 = 111;
    harnessB.state.weeklyRevenue0 = 222;

    registerMountedHarness(controller, mounts[0] as Element, 'shared', harnessA);
    registerMountedHarness(controller, mounts[1] as Element, 'shared', harnessB);
    await flushMutationObserverQueue();

    success.style.display = 'block';
    await flushMutationObserverQueue();

    expect(readLeadGateStorage().leadSubmitted).toBe(true);
    expect(
      readCalculatorSnapshot(resolveLeadGatePageScope('/'), 'graph:shared')?.weeklyRevenue0
    ).toBe(222);
  });

  it('opens modal on the third qualifying input/drag state change', () => {
    const { harness, modal } = setupInteractionTestContext();

    seedTwoQualifyingInteractions(harness);

    expect(modal.classList.contains('show')).toBe(false);

    harness.handle.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    harness.state.grossMargin = 0.7;
    harness.svg.dispatchEvent(new Event('pointerup', { bubbles: true }));

    expect(modal.classList.contains('show')).toBe(true);
  });

  it('ignores no-op applies and interactions after lead submit', () => {
    const { harness, modal } = setupInteractionTestContext();

    harness.inputRevenue.dispatchEvent(new Event('focus'));
    harness.inputRevenue.dispatchEvent(new Event('blur'));
    harness.inputGrowth.dispatchEvent(new Event('focus'));
    harness.inputGrowth.dispatchEvent(new Event('blur'));
    harness.handle.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    harness.svg.dispatchEvent(new Event('pointerup', { bubbles: true }));
    expect(modal.classList.contains('show')).toBe(false);

    setLeadSubmitted(true);
    harness.inputRevenue.dispatchEvent(new Event('focus'));
    harness.state.weeklyRevenue0 = 500;
    harness.inputRevenue.dispatchEvent(new Event('blur'));
    harness.inputFixed.dispatchEvent(new Event('focus'));
    harness.state.weeklyFixedExpenses = 1900;
    harness.inputFixed.dispatchEvent(new Event('blur'));
    harness.handle.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    harness.state.grossMargin = 0.4;
    harness.svg.dispatchEvent(new Event('pointerup', { bubbles: true }));
    expect(modal.classList.contains('show')).toBe(false);
  });

  it('rebinds listeners per mount without stacking duplicates', () => {
    const { mount, harness, controller, modal } = setupInteractionTestContext();
    controller.registerCalculatorInstance(mount, harness.legacyInstance);

    harness.inputRevenue.dispatchEvent(new Event('focus'));
    harness.state.weeklyRevenue0 = 201;
    harness.inputRevenue.dispatchEvent(new Event('blur'));

    harness.inputFixed.dispatchEvent(new Event('focus'));
    harness.state.weeklyFixedExpenses = 1901;
    harness.inputFixed.dispatchEvent(new Event('blur'));

    expect(modal.classList.contains('show')).toBe(false);

    harness.inputGrowth.dispatchEvent(new Event('focus'));
    harness.state.weeklyGrowthRate = 0.1;
    harness.inputGrowth.dispatchEvent(new Event('blur'));

    expect(modal.classList.contains('show')).toBe(true);
  });

  it('ignores cancelled drags for interaction counting', () => {
    const { harness, modal } = setupInteractionTestContext();

    seedTwoQualifyingInteractions(harness);

    harness.handle.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    harness.state.grossMargin = 0.7;
    harness.svg.dispatchEvent(new Event('pointercancel', { bubbles: true }));

    expect(modal.classList.contains('show')).toBe(false);

    harness.inputFixed.dispatchEvent(new Event('focus'));
    harness.state.weeklyFixedExpenses = 1900;
    harness.inputFixed.dispatchEvent(new Event('blur'));

    expect(modal.classList.contains('show')).toBe(true);
  });
});
