import { cp, copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

interface PackageJsonShape {
  name: string;
  version: string;
}

interface CodepenPrefill {
  js_external?: string;
  [key: string]: unknown;
}

interface DeployManifest {
  generatedAtIso: string;
  pagesBaseUrl: string;
  urlMode: 'absolute' | 'relative';
  stableAssets: {
    widget: string;
    scene: string;
  };
  versionedAssets: {
    widget: string;
    scene: string;
  };
  codepenPrefills: {
    single: string;
    scene: string;
  };
}

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST_DIR = resolve(ROOT_DIR, 'dist');
const SITE_DIR = resolve(DIST_DIR, 'site');
const CODEPEN_DIR = resolve(DIST_DIR, 'codepen');
const PAGES_DIR = resolve(DIST_DIR, 'pages');

const WIDGET_LATEST_FILE = 'widget.latest.js';
const SCENE_LATEST_FILE = 'scene.latest.js';
const WEBFLOW_LEGACY_FILE = 'webflow-growth-calculator.js';

interface PublishUrlContext {
  baseUrl: string;
  mode: 'absolute' | 'relative';
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/g, '');
}

function sanitizeVersion(value: string): string {
  return value.replace(/[^0-9A-Za-z.-]+/g, '-');
}

function sanitizeBuildId(value: string): string {
  return value.replace(/[^0-9A-Za-z.-]+/g, '-').replace(/^-+|-+$/g, '');
}

function normalizeEnvValue(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed === '') {
    return null;
  }
  return trimmed;
}

function resolveGithubPagesBase(githubRepository: string | null): string | null {
  if (!githubRepository) {
    return null;
  }
  const [owner, repo] = githubRepository.split('/');
  if (!owner || !repo) {
    return null;
  }
  return `https://${owner}.github.io/${repo}`;
}

function resolveBuildCandidate(
  rawValue: string | undefined,
  maxLength: number | null = null
): string | null {
  const normalizedValue = normalizeEnvValue(rawValue);
  if (!normalizedValue) {
    return null;
  }

  const sanitized = sanitizeBuildId(normalizedValue);
  if (sanitized === '') {
    return null;
  }

  if (maxLength === null) {
    return sanitized;
  }
  return sanitized.slice(0, maxLength);
}

async function readPackageJson(): Promise<PackageJsonShape> {
  const raw = await readFile(resolve(ROOT_DIR, 'package.json'), 'utf8');
  return JSON.parse(raw) as PackageJsonShape;
}

function resolvePublishUrlContext(): PublishUrlContext {
  const explicitBase = normalizeEnvValue(process.env.IMS_PAGES_BASE_URL);
  if (explicitBase) {
    return {
      baseUrl: trimTrailingSlash(explicitBase),
      mode: 'absolute'
    };
  }

  const githubPagesBase = resolveGithubPagesBase(normalizeEnvValue(process.env.GITHUB_REPOSITORY));
  if (githubPagesBase) {
    return {
      baseUrl: githubPagesBase,
      mode: 'absolute'
    };
  }

  if (process.env.CI === 'true') {
    throw new Error(
      'Missing publish base URL. Set IMS_PAGES_BASE_URL or GITHUB_REPOSITORY in CI.'
    );
  }

  return {
    baseUrl: '.',
    mode: 'relative'
  };
}

function resolveBuildId(): string {
  const candidates = [
    resolveBuildCandidate(process.env.IMS_BUILD_ID),
    resolveBuildCandidate(process.env.GITHUB_SHA, 12),
    resolveBuildCandidate(process.env.GITHUB_RUN_ID)
  ];
  const buildId = candidates.find((candidate) => candidate !== null);
  if (buildId) {
    return buildId;
  }

  if (process.env.CI === 'true') {
    throw new Error(
      'Missing build identifier. Set IMS_BUILD_ID, GITHUB_SHA, or GITHUB_RUN_ID in CI.'
    );
  }

  return `local-${Date.now().toString(36)}`;
}

function publishedUrl(context: PublishUrlContext, fileName: string): string {
  if (context.mode === 'relative') {
    return fileName;
  }
  return `${context.baseUrl}/${fileName}`;
}

function codepenRuntimeUrl(context: PublishUrlContext, fileName: string): string {
  if (context.mode === 'relative') {
    return `../${fileName}`;
  }
  return `${context.baseUrl}/${fileName}`;
}

function codepenPrefillUrl(context: PublishUrlContext, fileName: string): string {
  if (context.mode === 'relative') {
    return `codepen/${fileName}`;
  }
  return `${context.baseUrl}/codepen/${fileName}`;
}

async function rewritePrefillJsExternal(
  prefillPath: string,
  runtimeUrl: string
): Promise<void> {
  const raw = await readFile(prefillPath, 'utf8');
  const parsed = JSON.parse(raw) as CodepenPrefill;
  parsed.js_external = runtimeUrl;
  await writeFile(prefillPath, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
}

async function writeDeployManifest(
  context: PublishUrlContext,
  widgetVersionedFile: string,
  sceneVersionedFile: string
): Promise<void> {
  const manifest: DeployManifest = {
    generatedAtIso: new Date().toISOString(),
    pagesBaseUrl: context.baseUrl,
    urlMode: context.mode,
    stableAssets: {
      widget: publishedUrl(context, WIDGET_LATEST_FILE),
      scene: publishedUrl(context, SCENE_LATEST_FILE)
    },
    versionedAssets: {
      widget: publishedUrl(context, widgetVersionedFile),
      scene: publishedUrl(context, sceneVersionedFile)
    },
    codepenPrefills: {
      single: codepenPrefillUrl(context, 'prefill.json'),
      scene: codepenPrefillUrl(context, 'scene-prefill.json')
    }
  };

  await writeFile(
    resolve(PAGES_DIR, 'deploy-manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8'
  );
}

async function main(): Promise<void> {
  const packageJson = await readPackageJson();
  const versionTag = sanitizeVersion(packageJson.version);
  const publishUrlContext = resolvePublishUrlContext();
  const buildId = resolveBuildId();

  const widgetVersionedFile = `widget.v${versionTag}.${buildId}.js`;
  const sceneVersionedFile = `scene.v${versionTag}.${buildId}.js`;

  await rm(PAGES_DIR, { recursive: true, force: true });
  await mkdir(PAGES_DIR, { recursive: true });

  await cp(SITE_DIR, PAGES_DIR, { recursive: true });
  await cp(CODEPEN_DIR, resolve(PAGES_DIR, 'codepen'), { recursive: true });

  await copyFile(resolve(DIST_DIR, WIDGET_LATEST_FILE), resolve(PAGES_DIR, WIDGET_LATEST_FILE));
  await copyFile(resolve(DIST_DIR, SCENE_LATEST_FILE), resolve(PAGES_DIR, SCENE_LATEST_FILE));
  await copyFile(resolve(DIST_DIR, WEBFLOW_LEGACY_FILE), resolve(PAGES_DIR, WEBFLOW_LEGACY_FILE));

  await copyFile(resolve(DIST_DIR, WIDGET_LATEST_FILE), resolve(PAGES_DIR, widgetVersionedFile));
  await copyFile(resolve(DIST_DIR, SCENE_LATEST_FILE), resolve(PAGES_DIR, sceneVersionedFile));

  await rewritePrefillJsExternal(
    resolve(PAGES_DIR, 'codepen/prefill.json'),
    codepenRuntimeUrl(publishUrlContext, WIDGET_LATEST_FILE)
  );
  await rewritePrefillJsExternal(
    resolve(PAGES_DIR, 'codepen/scene-prefill.json'),
    codepenRuntimeUrl(publishUrlContext, SCENE_LATEST_FILE)
  );

  await writeDeployManifest(publishUrlContext, widgetVersionedFile, sceneVersionedFile);
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
