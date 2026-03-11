import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';

interface CodepenShellAssets {
  html: string;
  css: string;
  js: string;
  expectedJsExternal: string[];
}

interface StorageCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'Lax' | 'None' | 'Strict';
}

interface StorageStateLike {
  cookies: StorageCookie[];
  origins: Array<{
    origin: string;
    localStorage: Array<{
      name: string;
      value: string;
    }>;
  }>;
}

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CODEPEN_EDITOR_ROOT = 'https://codepen.io/pen';
const DEFAULT_PEN_ID = 'xbEGZyV';
const DEFAULT_DIST_PREFIX = 'pen';
const DEFAULT_COOKIE_DOMAIN = '.codepen.io';
const MAX_BOOT_WAIT_MS = 90_000;
const SAVE_WAIT_MS = 30_000;

function normalizeEnv(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  const normalized = value.trim();
  if (normalized === '') {
    return null;
  }
  return normalized;
}

function safeJsonParse<T>(input: string, context: string): T {
  try {
    return JSON.parse(input) as T;
  } catch (error) {
    throw new Error(`Invalid JSON for ${context}: ${String(error)}`);
  }
}

function toStorageStateLike(value: unknown): StorageStateLike {
  if (!value || typeof value !== 'object') {
    throw new Error('CODEPEN storage state must be an object.');
  }
  const candidate = value as Partial<StorageStateLike> & {
    cookies?: unknown[];
    origins?: unknown[];
  };
  const cookiesRaw = Array.isArray(candidate.cookies) ? candidate.cookies : [];
  const originsRaw = Array.isArray(candidate.origins) ? candidate.origins : [];

  const cookies = cookiesRaw
    .map((cookie) => toStorageCookie(cookie))
    .filter((cookie): cookie is StorageCookie => cookie !== null);
  const origins = originsRaw
    .map((origin) => toStorageOrigin(origin))
    .filter((origin): origin is StorageStateLike['origins'][number] => origin !== null);

  return { cookies, origins };
}

function toStorageCookie(value: unknown): StorageCookie | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const cookie = value as Partial<StorageCookie> & {
    name?: unknown;
    value?: unknown;
    domain?: unknown;
    path?: unknown;
    expires?: unknown;
    httpOnly?: unknown;
    secure?: unknown;
    sameSite?: unknown;
  };

  const name = typeof cookie.name === 'string' ? cookie.name : '';
  const cookieValue = typeof cookie.value === 'string' ? cookie.value : '';
  if (name === '' || cookieValue === '') {
    return null;
  }

  const domain = typeof cookie.domain === 'string' && cookie.domain !== ''
    ? cookie.domain
    : DEFAULT_COOKIE_DOMAIN;
  const path = typeof cookie.path === 'string' && cookie.path !== ''
    ? cookie.path
    : '/';
  const expires = typeof cookie.expires === 'number' ? cookie.expires : -1;
  const httpOnly = typeof cookie.httpOnly === 'boolean' ? cookie.httpOnly : false;
  const secure = typeof cookie.secure === 'boolean' ? cookie.secure : true;
  const sameSite = cookie.sameSite === 'None' || cookie.sameSite === 'Strict'
    ? cookie.sameSite
    : 'Lax';

  return {
    name,
    value: cookieValue,
    domain,
    path,
    expires,
    httpOnly,
    secure,
    sameSite
  };
}

function toStorageOrigin(
  value: unknown
): StorageStateLike['origins'][number] | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const originCandidate = value as {
    origin?: unknown;
    localStorage?: unknown[];
  };
  const origin = typeof originCandidate.origin === 'string' ? originCandidate.origin : '';
  if (origin === '') {
    return null;
  }

  const localStorageRaw = Array.isArray(originCandidate.localStorage)
    ? originCandidate.localStorage
    : [];
  const localStorage = localStorageRaw
    .map((entry) => toStorageEntry(entry))
    .filter((entry): entry is { name: string; value: string } => entry !== null);

  return {
    origin,
    localStorage
  };
}

function toStorageEntry(value: unknown): { name: string; value: string } | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const entry = value as {
    name?: unknown;
    value?: unknown;
  };
  const name = typeof entry.name === 'string' ? entry.name : '';
  const entryValue = typeof entry.value === 'string' ? entry.value : '';
  if (name === '') {
    return null;
  }
  return {
    name,
    value: entryValue
  };
}

function buildCookie(
  name: string,
  value: string,
  domain: string,
  httpOnly: boolean
): StorageCookie {
  return {
    name,
    value,
    domain,
    path: '/',
    expires: -1,
    httpOnly,
    secure: true,
    sameSite: 'Lax'
  };
}

function resolveStorageState(): StorageStateLike {
  const storageStateJson = normalizeEnv(process.env.CODEPEN_STORAGE_STATE_JSON);
  if (storageStateJson) {
    return toStorageStateLike(safeJsonParse<unknown>(storageStateJson, 'CODEPEN_STORAGE_STATE_JSON'));
  }

  const cookiesJson = normalizeEnv(process.env.CODEPEN_COOKIES_JSON);
  if (cookiesJson) {
    const parsed = safeJsonParse<unknown>(cookiesJson, 'CODEPEN_COOKIES_JSON');
    if (!Array.isArray(parsed)) {
      return toStorageStateLike(parsed);
    }
    const cookies = parsed
      .map((cookie) => toStorageCookie(cookie))
      .filter((cookie): cookie is StorageCookie => cookie !== null);
    return {
      cookies,
      origins: []
    };
  }

  const sessionCookie = normalizeEnv(process.env.CODEPEN_SESSION_COOKIE);
  if (!sessionCookie) {
    throw new Error(
      'Missing CodePen auth. Set CODEPEN_STORAGE_STATE_JSON, CODEPEN_COOKIES_JSON, or CODEPEN_SESSION_COOKIE.'
    );
  }

  const cookieDomain = normalizeEnv(process.env.CODEPEN_COOKIE_DOMAIN) || DEFAULT_COOKIE_DOMAIN;
  const cookies: StorageCookie[] = [buildCookie('cp_session', sessionCookie, cookieDomain, true)];

  const rememberToken = normalizeEnv(process.env.CODEPEN_REMEMBER_USER_TOKEN);
  if (rememberToken) {
    cookies.push(buildCookie('remember_user_token', rememberToken, cookieDomain, false));
  }

  return {
    cookies,
    origins: []
  };
}

function resolveEditorUrl(): string {
  const penId = normalizeEnv(process.env.CODEPEN_PEN_ID) || DEFAULT_PEN_ID;
  return `${CODEPEN_EDITOR_ROOT}/${penId}?editors=101`;
}

function resolveDistPrefix(): string {
  return normalizeEnv(process.env.CODEPEN_DIST_PREFIX) || DEFAULT_DIST_PREFIX;
}

function resolvePrefillFileName(distPrefix: string): string {
  const explicitPrefill = normalizeEnv(process.env.CODEPEN_PREFILL_FILE);
  if (explicitPrefill) {
    return explicitPrefill;
  }
  if (distPrefix === 'pen') {
    return 'prefill.json';
  }
  if (distPrefix === 'scene-pen') {
    return 'scene-prefill.json';
  }
  return `${distPrefix}.json`;
}

function splitExternalUrls(value: string): string[] {
  return value
    .split(/[;\n,]/g)
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
}

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values)).sort((left, right) => left.localeCompare(right));
}

function toExpectedJsExternalList(prefillRaw: string, prefillName: string): string[] {
  const parsed = safeJsonParse<{ js_external?: unknown }>(prefillRaw, prefillName);
  const jsExternal = typeof parsed.js_external === 'string' ? parsed.js_external : '';
  const expected = splitExternalUrls(jsExternal);
  if (expected.length > 0) {
    return uniqueSorted(expected);
  }
  throw new Error(`Missing js_external in dist/codepen/${prefillName}.`);
}

function parseJsExternalMatches(pageContent: string): string[] {
  const pattern = /"js_external"\s*:\s*"((?:\\.|[^"\\])*)"/g;
  const found: string[] = [];

  for (const match of pageContent.matchAll(pattern)) {
    const encoded = match[1];
    const decoded = safeJsonParse<string>(`"${encoded}"`, 'CodePen page js_external');
    const urls = splitExternalUrls(decoded);
    found.push(...urls);
  }

  return uniqueSorted(found);
}

async function readCodepenAssets(distPrefix: string): Promise<CodepenShellAssets> {
  const distCodepenDir = resolve(ROOT_DIR, 'dist/codepen');
  const htmlPath = resolve(distCodepenDir, `${distPrefix}.html`);
  const cssPath = resolve(distCodepenDir, `${distPrefix}.css`);
  const jsPath = resolve(distCodepenDir, `${distPrefix}.js`);
  const prefillPath = resolve(distCodepenDir, resolvePrefillFileName(distPrefix));

  const [html, css, js, prefillRaw] = await Promise.all([
    readFile(htmlPath, 'utf8'),
    readFile(cssPath, 'utf8'),
    readFile(jsPath, 'utf8'),
    readFile(prefillPath, 'utf8')
  ]);
  const prefillName = resolvePrefillFileName(distPrefix);
  const expectedJsExternal = toExpectedJsExternalList(prefillRaw, prefillName);

  return { html, css, js, expectedJsExternal };
}

async function clickFirstVisible(candidates: Locator[]): Promise<boolean> {
  for (const candidate of candidates) {
    const count = await candidate.count();
    if (count === 0) {
      continue;
    }
    const first = candidate.first();
    const visible = await first.isVisible().catch(() => false);
    if (!visible) {
      continue;
    }
    await first.click();
    return true;
  }
  return false;
}

function editorTabCandidates(page: Page, label: string): Locator[] {
  const titlePattern = new RegExp(`^${label}$`, 'i');
  return [
    page.getByRole('tab', { name: titlePattern }),
    page.getByRole('button', { name: titlePattern }),
    page.locator('[data-testid*="tab"]', { hasText: titlePattern }),
    page.locator('button, a', { hasText: titlePattern })
  ];
}

function activeEditorCandidates(page: Page): Locator[] {
  return [
    page.locator('[role="tabpanel"]:not([hidden]) .CodeMirror'),
    page.locator('.CodeMirror-focused'),
    page.locator('.CodeMirror:visible')
  ];
}

async function focusEditor(page: Page, label: string): Promise<void> {
  const activatedTab = await clickFirstVisible(editorTabCandidates(page, label));
  if (!activatedTab) {
    throw new Error(`Could not activate ${label} tab in CodePen editor.`);
  }

  const focusedEditor = await clickFirstVisible(activeEditorCandidates(page));
  if (!focusedEditor) {
    throw new Error(`Could not focus active ${label} editor in CodePen.`);
  }
}

async function replaceFocusedEditorContent(page: Page, content: string): Promise<void> {
  const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
  await page.keyboard.press(`${modifier}+a`);
  await page.keyboard.insertText(content);
}

async function setPanelContent(page: Page, label: 'HTML' | 'CSS' | 'JS', content: string): Promise<void> {
  await focusEditor(page, label);
  await replaceFocusedEditorContent(page, content);
}

async function waitForEditorReady(page: Page): Promise<void> {
  await page.waitForSelector('.CodeMirror, [role="tab"], [role="tabpanel"]', {
    timeout: MAX_BOOT_WAIT_MS
  });

  const isLoginPage = page.url().includes('/login');
  if (isLoginPage) {
    throw new Error('CodePen editor requires login. Provided cookies/session are not valid.');
  }
}

function sameUrlSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((entry, index) => entry === right[index]);
}

async function assertJsExternalMatches(page: Page, expectedJsExternal: string[]): Promise<void> {
  const pageContent = await page.content();
  const currentJsExternal = parseJsExternalMatches(pageContent);
  if (currentJsExternal.length === 0) {
    throw new Error('Could not read current CodePen js_external list from editor page.');
  }

  if (sameUrlSet(currentJsExternal, expectedJsExternal)) {
    return;
  }

  throw new Error(
    `CodePen js_external mismatch.\nExpected: ${expectedJsExternal.join(', ')}\nCurrent: ${currentJsExternal.join(', ')}`
  );
}

async function triggerSave(page: Page): Promise<void> {
  const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
  const responsePromise = page
    .waitForResponse((response) => {
      const request = response.request();
      if (request.method() !== 'POST') {
        return false;
      }
      const url = response.url();
      return /\/save(\/|$|\?)/.test(url) || /\/pen\/[^/]+\/save/.test(url);
    }, { timeout: SAVE_WAIT_MS })
    .then(() => true)
    .catch(() => false);

  const toastPromise = page
    .getByText(/saved/i)
    .first()
    .waitFor({ timeout: SAVE_WAIT_MS, state: 'visible' })
    .then(() => true)
    .catch(() => false);

  const saveButtonClicked = await clickFirstVisible([
    page.getByRole('button', { name: /^save$/i }),
    page.getByRole('button', { name: /save/i }),
    page.locator('button', { hasText: /^Save$/i })
  ]);

  if (!saveButtonClicked) {
    await page.keyboard.press(`${modifier}+s`);
  }

  const [savedByResponse, savedByToast] = await Promise.all([responsePromise, toastPromise]);
  if (savedByResponse || savedByToast) {
    return;
  }

  throw new Error('Could not confirm CodePen save operation.');
}

async function openEditorContext(): Promise<{ browser: Browser; context: BrowserContext; page: Page }> {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState: resolveStorageState() });
  const page = await context.newPage();
  return { browser, context, page };
}

async function main(): Promise<void> {
  const distPrefix = resolveDistPrefix();
  const editorUrl = resolveEditorUrl();
  const assets = await readCodepenAssets(distPrefix);
  const { browser, context, page } = await openEditorContext();

  try {
    await page.goto(editorUrl, { waitUntil: 'domcontentloaded' });
    await waitForEditorReady(page);
    await assertJsExternalMatches(page, assets.expectedJsExternal);
    await setPanelContent(page, 'HTML', assets.html);
    await setPanelContent(page, 'CSS', assets.css);
    await setPanelContent(page, 'JS', assets.js);
    await triggerSave(page);
  } finally {
    await context.close();
    await browser.close();
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
