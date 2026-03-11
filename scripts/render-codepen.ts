import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

interface CodepenPrefillTemplate {
  title?: string;
  description?: string;
  tags?: string[];
  editors?: string;
}

interface CodepenPrefillPayload extends CodepenPrefillTemplate {
  html: string;
  css: string;
  js: string;
  js_external: string;
}

type PenVariantId = 'single' | 'scene';
type RuntimeKind = 'widget' | 'scene';

interface PenVariantDefinition {
  id: PenVariantId;
  templateDir: string;
  outputBaseName: string;
  prefillFileName: string;
  runtimeKind: RuntimeKind;
}

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATE_ROOT_DIR = resolve(ROOT_DIR, 'templates/codepen');
const OUTPUT_DIR = resolve(ROOT_DIR, 'dist/codepen');

const WIDGET_RUNTIME_URL = process.env.IMS_CODEPEN_WIDGET_URL || '../widget.latest.js';
const SCENE_RUNTIME_URL = process.env.IMS_CODEPEN_SCENE_URL || '../scene.latest.js';
const REQUESTED_VARIANT = (process.env.IMS_CODEPEN_VARIANT || 'all').trim();

const PEN_VARIANTS: PenVariantDefinition[] = [
  {
    id: 'single',
    templateDir: resolve(TEMPLATE_ROOT_DIR, 'single'),
    outputBaseName: 'pen',
    prefillFileName: 'prefill.json',
    runtimeKind: 'widget',
  },
  {
    id: 'scene',
    templateDir: resolve(TEMPLATE_ROOT_DIR, 'scene'),
    outputBaseName: 'scene-pen',
    prefillFileName: 'scene-prefill.json',
    runtimeKind: 'scene',
  },
];

function applyRuntimePlaceholders(template: string): string {
  return template
    .split('__IMS_WIDGET_RUNTIME_URL__')
    .join(WIDGET_RUNTIME_URL)
    .split('__IMS_SCENE_RUNTIME_URL__')
    .join(SCENE_RUNTIME_URL);
}

function resolveRuntimeUrl(runtimeKind: RuntimeKind): string {
  return runtimeKind === 'scene' ? SCENE_RUNTIME_URL : WIDGET_RUNTIME_URL;
}

function selectVariants(): PenVariantDefinition[] {
  if (REQUESTED_VARIANT === 'all') {
    return PEN_VARIANTS;
  }

  const selected = PEN_VARIANTS.find((variant) => variant.id === REQUESTED_VARIANT);
  if (selected) {
    return [selected];
  }

  throw new Error(
    `Invalid IMS_CODEPEN_VARIANT="${REQUESTED_VARIANT}". Supported values: all, single, scene.`
  );
}

async function readTemplate(variant: PenVariantDefinition, name: string): Promise<string> {
  const value = await readFile(resolve(variant.templateDir, name), 'utf8');
  return applyRuntimePlaceholders(value);
}

async function writeAsset(name: string, contents: string): Promise<void> {
  await writeFile(resolve(OUTPUT_DIR, name), contents, 'utf8');
}

async function buildPrefill(
  variant: PenVariantDefinition,
  html: string,
  css: string,
  js: string
): Promise<CodepenPrefillPayload> {
  const templateRaw = await readTemplate(variant, 'prefill.template.json');
  const template = JSON.parse(templateRaw) as CodepenPrefillTemplate;

  return {
    ...template,
    html,
    css,
    js,
    js_external: resolveRuntimeUrl(variant.runtimeKind),
  };
}

function outputFileName(baseName: string, extension: 'html' | 'css' | 'js'): string {
  return `${baseName}.${extension}`;
}

async function renderVariant(variant: PenVariantDefinition): Promise<void> {
  const html = await readTemplate(variant, 'pen.html');
  const css = await readTemplate(variant, 'pen.css');
  const js = await readTemplate(variant, 'pen.js');

  await writeAsset(outputFileName(variant.outputBaseName, 'html'), html);
  await writeAsset(outputFileName(variant.outputBaseName, 'css'), css);
  await writeAsset(outputFileName(variant.outputBaseName, 'js'), js);

  const prefill = await buildPrefill(variant, html, css, js);
  await writeAsset(variant.prefillFileName, `${JSON.stringify(prefill, null, 2)}\n`);
}

async function main(): Promise<void> {
  await rm(OUTPUT_DIR, { recursive: true, force: true });
  await mkdir(OUTPUT_DIR, { recursive: true });

  const variants = selectVariants();
  for (const variant of variants) {
    await renderVariant(variant);
  }
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
