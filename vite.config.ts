import { resolve } from 'node:path';
import { defineConfig, type UserConfig } from 'vite';

const HTML_INPUTS = {
  index: resolve(__dirname, 'index.html'),
  previewShell: resolve(__dirname, 'preview-shell.html'),
  codepenShell: resolve(__dirname, 'codepen-shell.html')
};

const ENTRY_POINTS = {
  embed: resolve(__dirname, 'src/entries/site.ts')
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

function createWidgetConfig(): UserConfig {
  return {
    build: {
      outDir: 'dist/widget',
      emptyOutDir: true,
      lib: {
        entry: ENTRY_POINTS.embed,
        name: 'ImsGrowthEmbed',
        formats: ['es', 'iife'],
        fileName: (format) => (format === 'iife' ? 'webflow-growth-calculator.js' : 'embed.js')
      }
    }
  };
}

function createCodepenConfig(): UserConfig {
  return {
    base: './',
    build: {
      outDir: 'dist/codepen',
      emptyOutDir: true,
      rollupOptions: {
        input: {
          'codepen-shell': HTML_INPUTS.codepenShell
        }
      }
    }
  };
}

export default defineConfig(({ mode }) => {
  if (mode === 'widget') {
    return createWidgetConfig();
  }
  if (mode === 'codepen') {
    return createCodepenConfig();
  }
  return createSiteConfig();
});
