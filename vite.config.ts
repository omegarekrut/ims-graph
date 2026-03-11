import { resolve } from 'node:path';
import { defineConfig, type UserConfig } from 'vite';

const HTML_INPUTS = {
  index: resolve(__dirname, 'index.html'),
  previewShell: resolve(__dirname, 'preview-shell.html')
};

const WIDGET_ENTRIES = {
  singleGraph: resolve(__dirname, 'src/entries/single-graph.ts'),
  sceneRuntime: resolve(__dirname, 'src/entries/scene-runtime.ts')
};

const WIDGET_OUTPUT_FILES = {
  embed: 'ims-growth-calculator.iife.js',
  scene: 'scene-runtime.iife.js',
  legacy: 'webflow-growth-calculator.js'
};

function createSiteConfig(): UserConfig {
  return {
    base: './',
    server: {
      open: 'preview-shell.html'
    },
    build: {
      outDir: 'dist/site',
      emptyOutDir: true,
      rollupOptions: {
        input: {
          index: HTML_INPUTS.index,
          'preview-shell': HTML_INPUTS.previewShell
        }
      }
    }
  };
}

function createWidgetConfig(
  entry: string,
  fileName: string,
  globalName: string
): UserConfig {
  return {
    build: {
      outDir: 'dist',
      emptyOutDir: false,
      lib: {
        entry,
        name: globalName,
        formats: ['iife'],
        fileName: () => fileName
      },
      rollupOptions: {
        output: {
          extend: true
        }
      }
    }
  };
}

export default defineConfig(({ mode }) => {
  if (mode === 'widget-single') {
    return createWidgetConfig(
      WIDGET_ENTRIES.singleGraph,
      WIDGET_OUTPUT_FILES.embed,
      'ImsGrowthCalculatorWidgetRuntime'
    );
  }
  if (mode === 'widget-scene') {
    return createWidgetConfig(
      WIDGET_ENTRIES.sceneRuntime,
      WIDGET_OUTPUT_FILES.scene,
      'ImsGrowthCalculatorSceneRuntime'
    );
  }
  return createSiteConfig();
});
