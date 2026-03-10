export type Unit = 'week' | 'month' | 'quarter' | 'year';
export type ExpenseViz = 'bars' | 'lines';
export type GraphKind = 'growth-calculator' | (string & {});
export type GraphOptions = GrowthCalculatorOptions | Record<string, unknown>;

export type GraphId = string;
export type SceneId = string;

export type GraphMountTarget = string | Element;
export type SceneMountTarget = string | Element;

export type HandleId = 'revenue-start' | 'growth' | 'fixed' | 'variable';

export interface GrowthCalculatorOptions {
  units?: Unit;
  expenseViz?: ExpenseViz;
  weeklyRevenue0?: number;
  weeklyGrowthRate?: number;
  grossMargin?: number;
  weeklyFixedExpenses?: number;
  yearsMin?: number;
  yearsMax?: number;
}

export interface GrowthCalculatorState {
  units: Unit;
  expenseViz: ExpenseViz;
  weeklyRevenue0: number;
  weeklyGrowthRate: number;
  grossMargin: number;
  weeklyFixedExpenses: number;
  yearsMin: number;
  yearsMax: number;
}

export interface GrowthKpiMetrics {
  breakevenYears: number | null;
  billionYears: number | null;
}

export interface ChartDomain {
  yearsMin: number;
  yearsMax: number;
  yMin: number;
  yMax: number;
}

export interface HandlePoint {
  handleId: HandleId;
  x: number;
  y: number;
}

export interface GrowthCalculatorDomRefs {
  mount: Element;
  svg?: SVGSVGElement | null;
  form?: HTMLFormElement | null;
}

export type SceneGraphEventType =
  | 'graph:ready'
  | 'graph:output'
  | 'graph:input-applied'
  | 'store:updated'
  | 'scene:ready';

export interface SceneGraphSelector {
  graphId?: GraphId;
  selector?: string;
}

export interface GraphDependency {
  source: SceneGraphSelector;
  event?: 'graph:ready' | 'graph:output';
  outputKey?: string;
}

export interface GraphInputBinding {
  optionKey: string;
  storeKey: string;
}

export interface GraphOutputBinding {
  outputKey: string;
  storeKey?: string;
  event?: 'graph:output';
}

export interface SceneDerivedValueDefinition {
  key: string;
  dependsOn: string[];
  derive: (state: Readonly<Record<string, unknown>>) => unknown;
}

export interface SceneStoreChangeEvent {
  type: 'store:updated';
  key: string;
  value: unknown;
  previousValue: unknown;
  sourceGraphId: GraphId | null;
  derived: boolean;
  snapshot: Record<string, unknown>;
}

export interface SceneSharedStore {
  get(key: string): unknown;
  set(key: string, value: unknown, sourceGraphId?: GraphId | null): void;
  setMany(values: Record<string, unknown>, sourceGraphId?: GraphId | null): void;
  snapshot(): Record<string, unknown>;
  subscribe(listener: (event: SceneStoreChangeEvent) => void): () => void;
}

export interface SceneGraphEvent {
  type: SceneGraphEventType;
  sceneId: SceneId;
  graphId: GraphId | null;
  outputKey?: string;
  storeKey?: string;
  source?: SceneGraphSelector;
  value?: unknown;
  timestampMs: number;
}

export interface GraphDefinition {
  graphId?: GraphId;
  kind?: GraphKind;
  mount: GraphMountTarget;
  options?: GraphOptions;
  inputs?: GraphInputBinding[];
  outputs?: GraphOutputBinding[];
  dependsOn?: GraphDependency[];
}

export interface GraphInstance {
  graphId: GraphId;
  kind: GraphKind;
  mount: Element;
  options: GraphOptions;
  legacyInstance: unknown | null;
  inputs: GraphInputBinding[];
  outputs: GraphOutputBinding[];
  dependsOn: GraphDependency[];
  sceneId: SceneId | null;
  createdAtMs: number;
}

export interface GraphRegistry {
  getById(graphId: GraphId): GraphInstance | null;
  getByMount(mount: Element): GraphInstance | null;
  list(): GraphInstance[];
  register(instance: GraphInstance): GraphInstance;
  removeById(graphId: GraphId): boolean;
  clear(): void;
}

export interface SceneDefinition {
  sceneId?: SceneId;
  mount: SceneMountTarget;
  graphs?: GraphDefinition[];
  sharedState?: Record<string, unknown>;
  derivedState?: SceneDerivedValueDefinition[];
}

export interface SceneInstance {
  sceneId: SceneId;
  mount: Element;
  graphs: GraphInstance[];
  store: SceneSharedStore | null;
  orchestrationEnabled: boolean;
  createdAtMs: number;
}

export interface LegacyGrowthCalculatorApi {
  init(target: GraphMountTarget, options?: GrowthCalculatorOptions): unknown | null;
  autoInit(): unknown[];
}

export interface ImsGrowthCalculatorPublicApi {
  init(target: GraphMountTarget, options?: GrowthCalculatorOptions): unknown | null;
  autoInit(root?: ParentNode): unknown[];
  initScene(scene: SceneDefinition | SceneMountTarget): SceneInstance | null;
  autoInitScene(root?: ParentNode): SceneInstance[];
}

declare global {
  interface Window {
    ImsGrowthCalculator?: ImsGrowthCalculatorPublicApi;
    __IMS_GRAPH_DISABLE_LEGACY_AUTO_INIT?: boolean;
    __IMS_GRAPH_RUNTIME_BOOTSTRAPPED__?: boolean;
  }
}
