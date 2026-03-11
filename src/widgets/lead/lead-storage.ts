import type { GrowthCalculatorOptions } from '../../core/contracts';
import { normalizeGrowthOptions } from '../../core/options';

export const LEAD_GATE_STORAGE_VERSION = 1;
export const LEAD_GATE_STORAGE_KEY = 'ims-growth-calculator:lead-gate';

export interface LeadModalMetadata {
  openCount: number;
  lastOpenedAtMs: number | null;
  lastClosedAtMs: number | null;
  lastSubmitSuccessAtMs: number | null;
}

export interface LeadGatePageState {
  calculators: Record<string, GrowthCalculatorOptions>;
}

export interface LeadGateStoragePayload {
  version: number;
  leadSubmitted: boolean;
  modal: LeadModalMetadata;
  pages: Record<string, LeadGatePageState>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function defaultModalMetadata(): LeadModalMetadata {
  return {
    openCount: 0,
    lastOpenedAtMs: null,
    lastClosedAtMs: null,
    lastSubmitSuccessAtMs: null,
  };
}

export function createDefaultLeadGateStoragePayload(): LeadGateStoragePayload {
  return {
    version: LEAD_GATE_STORAGE_VERSION,
    leadSubmitted: false,
    modal: defaultModalMetadata(),
    pages: {},
  };
}

function normalizeModalMetadata(value: unknown): LeadModalMetadata {
  if (!isRecord(value)) {
    return defaultModalMetadata();
  }

  return {
    openCount: isFiniteNumber(value.openCount) && value.openCount >= 0 ? value.openCount : 0,
    lastOpenedAtMs: isFiniteNumber(value.lastOpenedAtMs) ? value.lastOpenedAtMs : null,
    lastClosedAtMs: isFiniteNumber(value.lastClosedAtMs) ? value.lastClosedAtMs : null,
    lastSubmitSuccessAtMs: isFiniteNumber(value.lastSubmitSuccessAtMs)
      ? value.lastSubmitSuccessAtMs
      : null,
  };
}

function normalizeCalculatorSnapshots(value: unknown): Record<string, GrowthCalculatorOptions> {
  if (!isRecord(value)) {
    return {};
  }

  const normalized: Record<string, GrowthCalculatorOptions> = {};

  Object.entries(value).forEach(([mountKey, optionsValue]) => {
    if (typeof mountKey !== 'string' || mountKey.trim() === '') {
      return;
    }
    if (!isRecord(optionsValue)) {
      return;
    }

    const options = normalizeGrowthOptions(optionsValue as GrowthCalculatorOptions);
    if (!Object.keys(options).length) {
      return;
    }

    normalized[mountKey] = options;
  });

  return normalized;
}

function normalizePages(value: unknown): Record<string, LeadGatePageState> {
  if (!isRecord(value)) {
    return {};
  }

  const normalized: Record<string, LeadGatePageState> = {};

  Object.entries(value).forEach(([pageKey, pageValue]) => {
    if (typeof pageKey !== 'string' || pageKey.trim() === '') {
      return;
    }

    const pageRecord = isRecord(pageValue) ? pageValue : null;
    if (!pageRecord) {
      return;
    }

    const calculators = normalizeCalculatorSnapshots(pageRecord.calculators);
    if (!Object.keys(calculators).length) {
      return;
    }

    normalized[pageKey] = { calculators };
  });

  return normalized;
}

function normalizePayload(value: unknown): LeadGateStoragePayload {
  if (!isRecord(value)) {
    return createDefaultLeadGateStoragePayload();
  }

  const version = value.version;
  if (version !== LEAD_GATE_STORAGE_VERSION) {
    return createDefaultLeadGateStoragePayload();
  }

  return {
    version: LEAD_GATE_STORAGE_VERSION,
    leadSubmitted: typeof value.leadSubmitted === 'boolean' ? value.leadSubmitted : false,
    modal: normalizeModalMetadata(value.modal),
    pages: normalizePages(value.pages),
  };
}

function resolveStorage(storage: Storage | null | undefined): Storage | null {
  if (typeof storage !== 'undefined') {
    return storage;
  }

  if (typeof window === 'undefined') {
    return null;
  }

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function readRawStorageValue(storage: Storage | null | undefined): string | null {
  const target = resolveStorage(storage);
  if (!target) {
    return null;
  }

  try {
    return target.getItem(LEAD_GATE_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeRawStorageValue(value: string, storage: Storage | null | undefined): boolean {
  const target = resolveStorage(storage);
  if (!target) {
    return false;
  }

  try {
    target.setItem(LEAD_GATE_STORAGE_KEY, value);
    return true;
  } catch {
    return false;
  }
}

export function resolveLeadGatePageScope(pathname?: string | null): string {
  const rawPathname =
    typeof pathname === 'string'
      ? pathname
      : typeof window !== 'undefined' && typeof window.location?.pathname === 'string'
        ? window.location.pathname
        : '/';

  const trimmed = rawPathname.trim();
  if (!trimmed) {
    return '/';
  }

  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

export function readLeadGateStorage(storage?: Storage | null): LeadGateStoragePayload {
  const raw = readRawStorageValue(storage);
  if (!raw) {
    return createDefaultLeadGateStoragePayload();
  }

  try {
    return normalizePayload(JSON.parse(raw));
  } catch {
    return createDefaultLeadGateStoragePayload();
  }
}

export function writeLeadGateStorage(
  payload: LeadGateStoragePayload,
  storage?: Storage | null
): boolean {
  const normalizedPayload = normalizePayload(payload);
  return writeRawStorageValue(JSON.stringify(normalizedPayload), storage);
}

export function updateLeadGateStorage(
  updater: (payload: LeadGateStoragePayload) => LeadGateStoragePayload,
  storage?: Storage | null
): LeadGateStoragePayload {
  const nextPayload = normalizePayload(updater(readLeadGateStorage(storage)));
  writeLeadGateStorage(nextPayload, storage);
  return nextPayload;
}

export function readLeadSubmitted(storage?: Storage | null): boolean {
  return readLeadGateStorage(storage).leadSubmitted;
}

export function setLeadSubmitted(
  submitted: boolean,
  storage?: Storage | null
): LeadGateStoragePayload {
  return updateLeadGateStorage(
    (payload) => ({
      ...payload,
      leadSubmitted: submitted,
    }),
    storage
  );
}

export function readCalculatorSnapshot(
  pageScope: string,
  mountIdentity: string,
  storage?: Storage | null
): GrowthCalculatorOptions | null {
  const payload = readLeadGateStorage(storage);
  const page = payload.pages[pageScope];
  if (!page) {
    return null;
  }

  return page.calculators[mountIdentity] || null;
}

export function writeCalculatorSnapshot(
  pageScope: string,
  mountIdentity: string,
  snapshot: GrowthCalculatorOptions,
  storage?: Storage | null
): LeadGateStoragePayload {
  const normalizedSnapshot = normalizeGrowthOptions(snapshot);

  return updateLeadGateStorage((payload) => {
    const existingPage = payload.pages[pageScope] || { calculators: {} };
    const nextPage: LeadGatePageState = {
      calculators: {
        ...existingPage.calculators,
        [mountIdentity]: normalizedSnapshot,
      },
    };

    return {
      ...payload,
      pages: {
        ...payload.pages,
        [pageScope]: nextPage,
      },
    };
  }, storage);
}

export function recordModalShown(storage?: Storage | null): LeadGateStoragePayload {
  return updateLeadGateStorage(
    (payload) => ({
      ...payload,
      modal: {
        ...payload.modal,
        openCount: payload.modal.openCount + 1,
        lastOpenedAtMs: Date.now(),
      },
    }),
    storage
  );
}

export function recordModalClosed(storage?: Storage | null): LeadGateStoragePayload {
  return updateLeadGateStorage(
    (payload) => ({
      ...payload,
      modal: {
        ...payload.modal,
        lastClosedAtMs: Date.now(),
      },
    }),
    storage
  );
}

export function recordModalSubmitSuccess(storage?: Storage | null): LeadGateStoragePayload {
  return updateLeadGateStorage(
    (payload) => ({
      ...payload,
      leadSubmitted: true,
      modal: {
        ...payload.modal,
        lastSubmitSuccessAtMs: Date.now(),
      },
    }),
    storage
  );
}
