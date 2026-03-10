import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
  autoInitEmbed,
  autoInitScene,
  autoInitSceneEmbed,
  initEmbed,
  initScene,
  initSceneEmbed,
  loadLegacyRuntime,
  publicApi,
  setRuntimeLegacyApi
} from '../../src/entries/embed';
import type { LegacyGrowthCalculatorApi } from '../../src/core/contracts';

describe('phase 2/3 runtime contracts', () => {
  it('preview/codepen shells keep mounts and module entrypoints', () => {
    const previewPath = resolve(process.cwd(), 'preview-shell.html');
    const html = readFileSync(previewPath, 'utf8');
    const indexPath = resolve(process.cwd(), 'index.html');
    const indexHtml = readFileSync(indexPath, 'utf8');
    const codepenShellPath = resolve(process.cwd(), 'codepen-shell.html');
    const codepenShellHtml = readFileSync(codepenShellPath, 'utf8');
    const viteConfigPath = resolve(process.cwd(), 'vite.config.ts');
    const viteConfig = readFileSync(viteConfigPath, 'utf8');

    expect(html).toContain('id="ims-growth-calc"');
    expect(html).toContain('src="./src/entries/site.ts"');
    expect(indexHtml).toContain('href="./preview-shell.html"');
    expect(codepenShellHtml).toContain('src="./src/entries/codepen.ts"');
    expect(viteConfig).toContain('webflow-growth-calculator.js');
  });

  it('embed entry is side-effect free until browser bootstrap runs', () => {
    expect(window.ImsGrowthCalculator).toBeUndefined();
    expect(loadLegacyRuntime()).toBeNull();
  });

  it('embed entry exports bootstrap and scene APIs', () => {
    expect(typeof initEmbed).toBe('function');
    expect(typeof autoInitEmbed).toBe('function');
    expect(typeof initScene).toBe('function');
    expect(typeof autoInitScene).toBe('function');
    expect(typeof initSceneEmbed).toBe('function');
    expect(typeof autoInitSceneEmbed).toBe('function');
  });

  it('runtime legacy adapter can be injected', () => {
    const fakeLegacyApi: LegacyGrowthCalculatorApi = {
      init: () => ({ ok: true }),
      autoInit: () => []
    };

    setRuntimeLegacyApi(fakeLegacyApi);

    expect(loadLegacyRuntime()).toBe(fakeLegacyApi);

    setRuntimeLegacyApi(null);
    expect(loadLegacyRuntime()).toBeNull();
  });

  it('legacy init contract routes through runtime adapter safely', () => {
    const mount = document.createElement('div');
    mount.id = 'ims-growth-calc';
    document.body.appendChild(mount);

    const initSpy = vi.fn(() => ({ ok: true }));
    const fakeLegacyApi: LegacyGrowthCalculatorApi = {
      init: initSpy,
      autoInit: () => []
    };

    setRuntimeLegacyApi(fakeLegacyApi);

    const emptySelectorResult = initEmbed('' as unknown as string, { weeklyRevenue0: 123 });
    expect(emptySelectorResult).toBeNull();
    expect(initSpy).toHaveBeenCalledTimes(0);

    const result = initEmbed('#ims-growth-calc', {
      units: 'week',
      weeklyRevenue0: 250,
      yearsMax: 7,
      expenseViz: 'bars',
      grossMargin: Number.NaN as unknown as number
    });

    expect(result).toEqual({ ok: true });
    expect(initSpy).toHaveBeenCalledTimes(1);
    expect(initSpy).toHaveBeenCalledWith(mount, {
      units: 'week',
      weeklyRevenue0: 250,
      yearsMax: 7,
      expenseViz: 'bars'
    });

    const undefinedTargetResult = initEmbed(undefined as unknown as Element, {});
    expect(undefinedTargetResult).toBeNull();

    setRuntimeLegacyApi(null);
    document.body.innerHTML = '';
  });

  it('codepen entry installs browser runtime and re-exports APIs', async () => {
    const codepenEntry = await import('../../src/entries/codepen');

    expect(typeof codepenEntry.initEmbed).toBe('function');
    expect(typeof codepenEntry.autoInitEmbed).toBe('function');
    expect(typeof codepenEntry.initScene).toBe('function');
    expect(typeof codepenEntry.autoInitScene).toBe('function');
    expect(typeof codepenEntry.initSceneEmbed).toBe('function');
    expect(typeof codepenEntry.autoInitSceneEmbed).toBe('function');
    expect(typeof codepenEntry.loadLegacyRuntime).toBe('function');
    expect(typeof codepenEntry.installBrowserRuntime).toBe('function');
    expect(window.ImsGrowthCalculator).toBe(publicApi);
  });
});
