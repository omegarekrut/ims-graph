import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GraphAdapter, GraphAdapterMountArgs } from '../../src/scenes/graph-adapters';
import { registerGraphAdapter, resolveGraphAdapter } from '../../src/scenes/graph-adapters';
import {
  autoInitGraphs,
  autoInitScenes,
  getGraphRegistry,
  getSceneRegistry,
  initGraph,
  initScene,
  resetRuntimeRegistry,
} from '../../src/scenes/runtime';

function createPassThroughAdapter(kind: string): GraphAdapter {
  return {
    kind,
    mount(args: GraphAdapterMountArgs) {
      return {
        graphId: args.graphId,
        kind: args.kind,
        mount: args.mount,
        options: { ...args.options },
        legacyInstance: null,
        inputs: args.definition.inputs || [],
        outputs: args.definition.outputs || [],
        dependsOn: args.definition.dependsOn || [],
        sceneId: args.sceneId,
        createdAtMs: Date.now(),
      };
    },
    readOutput(instance, outputKey) {
      return (instance.options as Record<string, unknown>)[outputKey];
    },
  };
}

function registerPassThroughAdapter(kind: string): void {
  registerGraphAdapter(createPassThroughAdapter(kind));
}

afterEach(() => {
  resetRuntimeRegistry();
  document.body.innerHTML = '';
});

describe('scene runtime', () => {
  it('initializes scene graphs from data attributes', () => {
    const scene = document.createElement('section');
    scene.setAttribute('data-ims-scene', 'scene-a');

    const graph = document.createElement('div');
    graph.setAttribute('data-ims-graph', 'graph-a');
    scene.appendChild(graph);
    document.body.appendChild(scene);

    const sceneInstance = initScene({ mount: scene });

    expect(sceneInstance).not.toBeNull();
    expect(sceneInstance?.sceneId).toBe('scene-a');
    expect(sceneInstance?.graphs.length).toBe(1);
    expect(sceneInstance?.graphs[0]?.graphId).toBe('graph-a');
  });

  it('autoInitScenes discovers all scene mounts', () => {
    const sceneA = document.createElement('div');
    sceneA.setAttribute('data-ims-scene', 'scene-a');
    sceneA.innerHTML = '<div data-ims-graph="graph-a"></div>';

    const sceneB = document.createElement('div');
    sceneB.setAttribute('data-ims-scene', 'scene-b');
    sceneB.innerHTML = '<div data-ims-graph="graph-b"></div>';

    document.body.appendChild(sceneA);
    document.body.appendChild(sceneB);

    const scenes = autoInitScenes(document);

    expect(scenes.length).toBe(2);
    expect(getGraphRegistry().list().length).toBe(2);
    expect(scenes[0]?.orchestrationEnabled).toBe(false);
    expect(scenes[0]?.store).toBeNull();
  });

  it('supports container-scoped direct graph initialization', () => {
    const mount = document.createElement('div');
    mount.id = 'ims-growth-calc';
    document.body.appendChild(mount);

    const graph = initGraph('#ims-growth-calc', { weeklyRevenue0: 200 });

    expect(graph).not.toBeNull();
    expect(graph?.graphId).toBe('ims-growth-calc');
    expect(graph?.options.weeklyRevenue0).toBe(200);

    const autoGraphs = autoInitGraphs(document);
    expect(autoGraphs.length).toBe(1);
    expect(autoGraphs[0]?.graphId).toBe('ims-growth-calc');
  });

  it('resetRuntimeRegistry removes stale mount lookup before reinit', () => {
    const mount = document.createElement('div');
    mount.setAttribute('data-ims-graph', 'graph-reset');
    document.body.appendChild(mount);

    const firstPass = autoInitGraphs(document);
    expect(firstPass.length).toBe(1);
    expect(getGraphRegistry().list().length).toBe(1);

    resetRuntimeRegistry();

    const secondPass = autoInitGraphs(document);
    expect(secondPass.length).toBe(1);
    expect(getGraphRegistry().list().length).toBe(1);
    expect(secondPass[0]).not.toBe(firstPass[0]);
  });

  it('outer scenes do not claim nested-scene graphs', () => {
    const outerScene = document.createElement('section');
    outerScene.setAttribute('data-ims-scene', 'outer-scene');

    const outerGraph = document.createElement('div');
    outerGraph.setAttribute('data-ims-graph', 'outer-graph');

    const innerScene = document.createElement('section');
    innerScene.setAttribute('data-ims-scene', 'inner-scene');

    const innerGraph = document.createElement('div');
    innerGraph.setAttribute('data-ims-graph', 'inner-graph');

    innerScene.appendChild(innerGraph);
    outerScene.appendChild(outerGraph);
    outerScene.appendChild(innerScene);
    document.body.appendChild(outerScene);

    const outerInstance = initScene({ mount: outerScene });
    const innerInstance = initScene({ mount: innerScene });

    expect(outerInstance?.graphs.map((graph) => graph.graphId)).toEqual(['outer-graph']);
    expect(innerInstance?.graphs.map((graph) => graph.graphId)).toEqual(['inner-graph']);
  });

  it('duplicate scene ids are uniquified per mount', () => {
    const sceneA = document.createElement('section');
    sceneA.setAttribute('data-ims-scene', 'dup-scene');
    sceneA.innerHTML = '<div data-ims-graph="graph-a"></div>';

    const sceneB = document.createElement('section');
    sceneB.setAttribute('data-ims-scene', 'dup-scene');
    sceneB.innerHTML = '<div data-ims-graph="graph-b"></div>';

    document.body.appendChild(sceneA);
    document.body.appendChild(sceneB);

    const first = initScene({ mount: sceneA });
    const second = initScene({ mount: sceneB });

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(first?.mount).toBe(sceneA);
    expect(second?.mount).toBe(sceneB);
    expect(first?.sceneId).toBe('dup-scene');
    expect(second?.sceneId).not.toBe('dup-scene');
    expect(second?.sceneId).not.toBe(first?.sceneId);
    expect(getSceneRegistry().length).toBe(2);
  });

  it('reused graph attaches to scene ownership on scene init', () => {
    const scene = document.createElement('section');
    scene.setAttribute('data-ims-scene', 'scene-own');

    const graph = document.createElement('div');
    graph.setAttribute('data-ims-graph', 'graph-own');
    scene.appendChild(graph);
    document.body.appendChild(scene);

    const direct = initGraph(graph, { weeklyRevenue0: 321 });
    expect(direct?.sceneId).toBeNull();

    const sceneInstance = initScene({ mount: scene });
    const resolved = getGraphRegistry().getByMount(graph);

    expect(sceneInstance?.graphs.length).toBe(1);
    expect(resolved).not.toBeNull();
    expect(resolved?.sceneId).toBe(sceneInstance?.sceneId || null);
    expect(resolved?.options.weeklyRevenue0).toBe(321);
  });

  it('reused graph remounts when scene options change', () => {
    const scene = document.createElement('section');
    scene.setAttribute('data-ims-scene', 'scene-remount');

    const graph = document.createElement('div');
    graph.setAttribute('data-ims-graph', 'graph-remount');
    scene.appendChild(graph);
    document.body.appendChild(scene);

    const initSpy = vi.fn((target: string | Element, options?: Record<string, unknown>) => ({
      target,
      options,
    }));
    const fakeLegacyApi = {
      init: initSpy,
      autoInit: () => [],
    };

    const first = initGraph(graph, { weeklyRevenue0: 100 }, fakeLegacyApi);
    expect(first).not.toBeNull();
    expect(initSpy).toHaveBeenCalledTimes(1);
    expect(first?.options.weeklyRevenue0).toBe(100);

    const sceneInstance = initScene(
      {
        mount: scene,
        graphs: [
          {
            mount: graph,
            options: { weeklyRevenue0: 500 },
          },
        ],
      },
      fakeLegacyApi
    );

    const resolved = getGraphRegistry().getByMount(graph);

    expect(sceneInstance).not.toBeNull();
    expect(sceneInstance?.graphs.length).toBe(1);
    expect(initSpy).toHaveBeenCalledTimes(2);
    expect(resolved?.options.weeklyRevenue0).toBe(500);
    expect(resolved?.sceneId).toBe(sceneInstance?.sceneId || null);
  });

  it('enables orchestration for graph dependencies and shared outputs', () => {
    const scene = document.createElement('section');
    scene.setAttribute('data-ims-scene', 'scene-orch');

    const source = document.createElement('div');
    source.setAttribute('data-ims-graph', 'graph-source');

    const target = document.createElement('div');
    target.setAttribute('data-ims-graph', 'graph-target');

    scene.appendChild(source);
    scene.appendChild(target);
    document.body.appendChild(scene);

    const sceneInstance = initScene({
      mount: scene,
      graphs: [
        {
          graphId: 'graph-source',
          mount: source,
          options: { weeklyRevenue0: 720 },
          outputs: [
            {
              outputKey: 'weeklyRevenue0',
              storeKey: 'seedRevenue',
            },
          ],
        },
        {
          graphId: 'graph-target',
          mount: target,
          dependsOn: [
            {
              source: { graphId: 'graph-source' },
              event: 'graph:output',
              outputKey: 'weeklyRevenue0',
            },
          ],
          inputs: [
            {
              optionKey: 'weeklyRevenue0',
              storeKey: 'seedRevenue',
            },
          ],
        },
      ],
    });

    expect(sceneInstance).not.toBeNull();
    expect(sceneInstance?.orchestrationEnabled).toBe(true);
    expect(sceneInstance?.store).not.toBeNull();

    const targetGraph = getGraphRegistry().getById('graph-target');
    expect(targetGraph).not.toBeNull();
    expect(targetGraph?.options.weeklyRevenue0).toBe(720);
  });

  it('supports selector-based dependency hooks between scene graphs', () => {
    const scene = document.createElement('section');
    scene.setAttribute('data-ims-scene', 'scene-selector');

    const source = document.createElement('div');
    source.className = 'source-graph';
    source.setAttribute('data-ims-graph', 'selector-source');

    const target = document.createElement('div');
    target.setAttribute('data-ims-graph', 'selector-target');

    scene.appendChild(source);
    scene.appendChild(target);
    document.body.appendChild(scene);

    const sceneInstance = initScene({
      mount: scene,
      graphs: [
        {
          graphId: 'selector-source',
          mount: source,
          options: { weeklyFixedExpenses: 4100 },
          outputs: [
            {
              outputKey: 'weeklyFixedExpenses',
              storeKey: 'sceneFixed',
            },
          ],
        },
        {
          graphId: 'selector-target',
          mount: target,
          dependsOn: [
            {
              source: { selector: '.source-graph' },
              event: 'graph:output',
              outputKey: 'weeklyFixedExpenses',
            },
          ],
          inputs: [
            {
              optionKey: 'weeklyFixedExpenses',
              storeKey: 'sceneFixed',
            },
          ],
        },
      ],
    });

    expect(sceneInstance?.orchestrationEnabled).toBe(true);

    const targetGraph = getGraphRegistry().getById('selector-target');
    expect(targetGraph).not.toBeNull();
    expect(targetGraph?.options.weeklyFixedExpenses).toBe(4100);
  });

  it('applies shared store and derived values for scene inputs', () => {
    const scene = document.createElement('section');
    scene.setAttribute('data-ims-scene', 'scene-store');

    const target = document.createElement('div');
    target.setAttribute('data-ims-graph', 'store-target');
    scene.appendChild(target);
    document.body.appendChild(scene);

    const sceneInstance = initScene({
      mount: scene,
      sharedState: {
        baseRevenue: 120,
      },
      derivedState: [
        {
          key: 'derivedRevenue',
          dependsOn: ['baseRevenue'],
          derive: (state) => Number(state.baseRevenue || 0) * 2,
        },
      ],
      graphs: [
        {
          graphId: 'store-target',
          mount: target,
          inputs: [
            {
              optionKey: 'weeklyRevenue0',
              storeKey: 'derivedRevenue',
            },
          ],
        },
      ],
    });

    expect(sceneInstance?.orchestrationEnabled).toBe(true);
    expect(sceneInstance?.store).not.toBeNull();

    const initialGraph = getGraphRegistry().getById('store-target');
    expect(initialGraph?.options.weeklyRevenue0).toBe(240);
    expect(sceneInstance?.graphs[0]?.options.weeklyRevenue0).toBe(240);

    sceneInstance?.store?.set('baseRevenue', 150);

    const updatedGraph = getGraphRegistry().getById('store-target');
    const updatedSceneGraph = sceneInstance?.graphs[0];
    expect(updatedGraph?.options.weeklyRevenue0).toBe(300);
    expect(updatedSceneGraph?.options.weeklyRevenue0).toBe(300);
    expect(updatedSceneGraph).toBe(updatedGraph);
    expect(updatedSceneGraph).not.toBe(initialGraph);
  });

  it('mounts registered custom graph adapters through scene runtime', () => {
    const scene = document.createElement('section');
    scene.setAttribute('data-ims-scene', 'scene-custom-adapter');

    const target = document.createElement('div');
    scene.appendChild(target);
    document.body.appendChild(scene);

    const customKind = 'unit-test-custom-adapter';
    registerPassThroughAdapter(customKind);

    const sceneInstance = initScene({
      mount: scene,
      graphs: [
        {
          graphId: 'custom-target',
          kind: customKind,
          mount: target,
          options: { weeklyRevenue0: 512 },
          outputs: [
            {
              outputKey: 'weeklyRevenue0',
              storeKey: 'customRevenue',
            },
          ],
        },
      ],
    });

    const mountedGraph = getGraphRegistry().getById('custom-target');
    expect(mountedGraph).not.toBeNull();
    expect(mountedGraph?.kind).toBe(customKind);
    expect(mountedGraph?.options.weeklyRevenue0).toBe(512);
    expect(sceneInstance?.graphs[0]).toBe(mountedGraph);
    expect(sceneInstance?.store?.get('customRevenue')).toBe(512);
  });

  it('supports adapter-specific custom bindings and store mapping', () => {
    const scene = document.createElement('section');
    scene.setAttribute('data-ims-scene', 'scene-custom-bindings');

    const target = document.createElement('div');
    scene.appendChild(target);
    document.body.appendChild(scene);

    const customKind = 'unit-test-custom-bindings';
    registerGraphAdapter({
      kind: customKind,
      normalizeInputs(inputs) {
        return inputs.filter((binding) => binding.optionKey.startsWith('custom:'));
      },
      normalizeOutputs(outputs) {
        return outputs.filter((binding) => binding.outputKey.startsWith('custom:'));
      },
      applyStoreInputs(options, inputs, store) {
        const next = { ...options } as Record<string, unknown>;
        inputs.forEach((binding) => {
          const raw = store.get(binding.storeKey);
          const numeric = typeof raw === 'number' ? raw : Number(raw || 0);
          next[binding.optionKey] = numeric * 10;
        });
        return next;
      },
      mount(args) {
        return {
          graphId: args.graphId,
          kind: args.kind,
          mount: args.mount,
          options: { ...args.options },
          legacyInstance: null,
          inputs: args.definition.inputs || [],
          outputs: args.definition.outputs || [],
          dependsOn: args.definition.dependsOn || [],
          sceneId: args.sceneId,
          createdAtMs: Date.now(),
        };
      },
      readOutput(instance, outputKey) {
        return (instance.options as Record<string, unknown>)[outputKey];
      },
    });

    const sceneInstance = initScene({
      mount: scene,
      sharedState: {
        seed: 7,
      },
      graphs: [
        {
          graphId: 'custom-binding-target',
          kind: customKind,
          mount: target,
          inputs: [
            {
              optionKey: 'custom:metric',
              storeKey: 'seed',
            },
            {
              optionKey: 'ignored:metric',
              storeKey: 'seed',
            },
          ],
          outputs: [
            {
              outputKey: 'custom:metric',
              storeKey: 'customMetric',
            },
            {
              outputKey: 'ignored:metric',
              storeKey: 'ignoredMetric',
            },
          ],
        },
      ],
    });

    const mountedGraph = getGraphRegistry().getById('custom-binding-target');
    expect(sceneInstance?.orchestrationEnabled).toBe(true);
    expect(mountedGraph).not.toBeNull();
    expect((mountedGraph?.options as Record<string, unknown>)['custom:metric']).toBe(70);
    expect((mountedGraph?.options as Record<string, unknown>)['ignored:metric']).toBeUndefined();
    expect(sceneInstance?.store?.get('customMetric')).toBe(70);
    expect(sceneInstance?.store?.get('ignoredMetric')).toBeUndefined();
  });

  it('re-normalizes adapter options after applying store inputs', () => {
    const scene = document.createElement('section');
    scene.setAttribute('data-ims-scene', 'scene-store-normalize');

    const target = document.createElement('div');
    scene.appendChild(target);
    document.body.appendChild(scene);

    const customKind = 'unit-test-store-normalize';
    registerGraphAdapter({
      kind: customKind,
      normalizeOptions(options) {
        const next = { ...((options as Record<string, unknown>) || {}) };
        const raw = next.customMetric;
        if (typeof raw !== 'undefined') {
          next.customMetric = Number(raw) * 10;
        }
        return next;
      },
      mount(args) {
        return {
          graphId: args.graphId,
          kind: args.kind,
          mount: args.mount,
          options: { ...args.options },
          legacyInstance: null,
          inputs: args.definition.inputs || [],
          outputs: args.definition.outputs || [],
          dependsOn: args.definition.dependsOn || [],
          sceneId: args.sceneId,
          createdAtMs: Date.now(),
        };
      },
      readOutput(instance, outputKey) {
        return (instance.options as Record<string, unknown>)[outputKey];
      },
    });

    const sceneInstance = initScene({
      mount: scene,
      sharedState: {
        seed: '7',
      },
      graphs: [
        {
          graphId: 'store-normalize-target',
          kind: customKind,
          mount: target,
          inputs: [
            {
              optionKey: 'customMetric',
              storeKey: 'seed',
            },
          ],
        },
      ],
    });

    const initialGraph = getGraphRegistry().getById('store-normalize-target');
    expect(sceneInstance?.orchestrationEnabled).toBe(true);
    expect(initialGraph).not.toBeNull();
    expect((initialGraph?.options as Record<string, unknown>).customMetric).toBe(70);

    sceneInstance?.store?.set('seed', '8');

    const updatedGraph = getGraphRegistry().getById('store-normalize-target');
    expect((updatedGraph?.options as Record<string, unknown>).customMetric).toBe(80);
  });

  it('fails soft on malformed graph inputs with non-string storeKey', () => {
    const scene = document.createElement('section');
    scene.setAttribute('data-ims-scene', 'scene-bad-input');

    const target = document.createElement('div');
    scene.appendChild(target);
    document.body.appendChild(scene);

    const malformedScene = {
      mount: scene,
      graphs: [
        {
          graphId: 'bad-input-target',
          mount: target,
          inputs: [
            {
              optionKey: 'weeklyRevenue0',
              storeKey: null,
            },
          ],
        },
      ],
    } as unknown as Parameters<typeof initScene>[0];

    const mountMalformedScene = () => initScene(malformedScene);
    expect(mountMalformedScene).not.toThrow();

    const sceneInstance = mountMalformedScene();
    expect(sceneInstance).not.toBeNull();
    expect(sceneInstance?.orchestrationEnabled).toBe(false);
    expect(sceneInstance?.graphs[0]?.graphId).toBe('bad-input-target');
  });

  it('fails soft on malformed derived state with non-string key', () => {
    const scene = document.createElement('section');
    scene.setAttribute('data-ims-scene', 'scene-bad-derived');

    const target = document.createElement('div');
    scene.appendChild(target);
    document.body.appendChild(scene);

    const malformedScene = {
      mount: scene,
      sharedState: {
        baseRevenue: 100,
      },
      derivedState: [
        {
          key: null,
          dependsOn: ['baseRevenue'],
          derive: (state: Readonly<Record<string, unknown>>) => Number(state.baseRevenue || 0) * 3,
        },
      ],
      graphs: [
        {
          graphId: 'bad-derived-target',
          mount: target,
        },
      ],
    } as unknown as Parameters<typeof initScene>[0];

    const mountMalformedScene = () => initScene(malformedScene);
    expect(mountMalformedScene).not.toThrow();

    const sceneInstance = mountMalformedScene();
    expect(sceneInstance).not.toBeNull();
    expect(sceneInstance?.orchestrationEnabled).toBe(true);
    expect(sceneInstance?.store?.snapshot()).not.toHaveProperty('null');
  });

  it('resetRuntimeRegistry clears registered custom adapters', () => {
    const customKind = 'unit-test-reset-adapter';

    registerPassThroughAdapter(customKind);

    const firstScene = document.createElement('section');
    firstScene.setAttribute('data-ims-scene', 'scene-reset-adapter-a');
    const firstTarget = document.createElement('div');
    firstScene.appendChild(firstTarget);
    document.body.appendChild(firstScene);

    const firstInstance = initScene({
      mount: firstScene,
      graphs: [
        {
          graphId: 'reset-adapter-a',
          kind: customKind,
          mount: firstTarget,
        },
      ],
    });

    expect(firstInstance?.graphs.length).toBe(1);
    expect(resolveGraphAdapter(customKind)).not.toBeNull();

    resetRuntimeRegistry();

    expect(resolveGraphAdapter(customKind)).toBeNull();

    const secondScene = document.createElement('section');
    secondScene.setAttribute('data-ims-scene', 'scene-reset-adapter-b');
    const secondTarget = document.createElement('div');
    secondScene.appendChild(secondTarget);
    document.body.appendChild(secondScene);

    const secondInstance = initScene({
      mount: secondScene,
      graphs: [
        {
          graphId: 'reset-adapter-b',
          kind: customKind,
          mount: secondTarget,
        },
      ],
    });

    expect(secondInstance).not.toBeNull();
    expect(secondInstance?.graphs.length).toBe(0);
    expect(getGraphRegistry().getById('reset-adapter-b')).toBeNull();
  });
});
