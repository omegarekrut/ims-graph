import { expect, type Locator, type Page } from '@playwright/test';

export type WidgetInputKey = 'revenue' | 'grossMargin' | 'fixed' | 'growth';
export type ApplyMode = 'blur' | 'enter';

export async function waitForWidgetMount(page: Page, graphId: string): Promise<Locator> {
  const mount = page.locator(`[data-ims-graph="${graphId}"]`);
  await expect(mount).toHaveCount(1);
  await expect(mount.locator('.igc')).toBeVisible();
  return mount;
}

export function widgetInput(mount: Locator, key: WidgetInputKey): Locator {
  return mount.locator(`.igc__input[data-key="${key}"]`);
}

export function widgetSummary(mount: Locator, key: 'breakeven' | 'billion' | 'funding'): Locator {
  return mount.locator(`.igc__summary-value[data-key="${key}"]`);
}

export async function fillAndApplyInput(
  mount: Locator,
  key: WidgetInputKey,
  value: string,
  mode: ApplyMode = 'blur'
): Promise<void> {
  const input = widgetInput(mount, key);
  await input.click();
  await input.fill(value);
  if (mode === 'enter') {
    await input.press('Enter');
    return;
  }
  await input.blur();
}
