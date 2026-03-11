import { expect, type Page, test } from '@playwright/test';

import { fillAndApplyInput, waitForWidgetMount } from './helpers/widget';

const LEAD_GATE_STORAGE_KEY = 'ims-growth-calculator:lead-gate';
const LEAD_MODAL_FLOW_PATH = '/tests/e2e/fixtures/lead-modal-flow.html';

interface LeadGateStoredCalculatorState {
  weeklyRevenue0?: number;
}

interface LeadGateStoredPageState {
  calculators?: Record<string, LeadGateStoredCalculatorState>;
}

interface LeadGateStoredPayload {
  leadSubmitted?: boolean;
  pages?: Record<string, LeadGateStoredPageState>;
}

async function readLeadGatePayload(page: Page): Promise<LeadGateStoredPayload | null> {
  return page.evaluate((storageKey) => {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      return null;
    }

    try {
      return JSON.parse(raw) as LeadGateStoredPayload;
    } catch {
      return null;
    }
  }, LEAD_GATE_STORAGE_KEY);
}

test.describe('lead modal flow', () => {
  test('opens on the third qualifying interaction and supports manual close', async ({ page }) => {
    await page.goto(LEAD_MODAL_FLOW_PATH);

    const mount = await waitForWidgetMount(page, 'lead-graph-a');
    const modal = page.locator('.calc_modal');

    await expect(modal).not.toHaveClass(/show/);

    await fillAndApplyInput(mount, 'revenue', '$1,000', 'blur');
    await fillAndApplyInput(mount, 'growth', '5%', 'enter');

    await expect(modal).not.toHaveClass(/show/);

    await fillAndApplyInput(mount, 'fixed', '$2,000', 'blur');
    await expect(modal).toHaveClass(/show/);

    await page.locator('.calc_modal-close').click();
    await expect(modal).not.toHaveClass(/show/);
  });

  test('persists submit success snapshots and restores values after reload', async ({ page }) => {
    await page.goto(LEAD_MODAL_FLOW_PATH);

    const graphA = await waitForWidgetMount(page, 'lead-graph-a');
    const graphB = await waitForWidgetMount(page, 'lead-graph-b');
    const modal = page.locator('.calc_modal');

    await fillAndApplyInput(graphA, 'revenue', '$1,234', 'blur');
    await fillAndApplyInput(graphA, 'growth', '4.5%', 'enter');
    await fillAndApplyInput(graphA, 'fixed', '$1,850', 'blur');
    await expect(modal).toHaveClass(/show/);

    await fillAndApplyInput(graphB, 'revenue', '$2,345', 'blur');

    await page.evaluate(() => {
      const successState = document.querySelector('.w-form-done');
      if (successState instanceof HTMLElement) {
        successState.style.display = 'block';
      }
    });

    await page.waitForFunction((storageKey) => {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) {
        return false;
      }

      try {
        const payload = JSON.parse(raw) as LeadGateStoredPayload;
        return payload.leadSubmitted === true;
      } catch {
        return false;
      }
    }, LEAD_GATE_STORAGE_KEY);

    const payload = await readLeadGatePayload(page);
    expect(payload?.leadSubmitted).toBe(true);
    expect(
      payload?.pages?.[LEAD_MODAL_FLOW_PATH]?.calculators?.['graph:lead-graph-a']?.weeklyRevenue0
    ).toBe(1234);
    expect(
      payload?.pages?.[LEAD_MODAL_FLOW_PATH]?.calculators?.['graph:lead-graph-b']?.weeklyRevenue0
    ).toBe(2345);

    await page.reload();

    const restoredGraphA = await waitForWidgetMount(page, 'lead-graph-a');
    const restoredGraphB = await waitForWidgetMount(page, 'lead-graph-b');

    await expect(restoredGraphA.locator('.igc__input[data-key="revenue"]')).toHaveValue('$1,234');
    await expect(restoredGraphB.locator('.igc__input[data-key="revenue"]')).toHaveValue('$2,345');
    await expect(modal).not.toHaveClass(/show/);

    await fillAndApplyInput(restoredGraphA, 'revenue', '$1,500', 'blur');
    await fillAndApplyInput(restoredGraphA, 'growth', '6%', 'enter');
    await fillAndApplyInput(restoredGraphA, 'fixed', '$1,950', 'blur');

    await expect(modal).not.toHaveClass(/show/);
  });

  test('keeps interaction ownership on the latest mount for shared stable keys', async ({
    page,
  }) => {
    await page.goto('/tests/e2e/fixtures/lead-modal-shared-key.html');

    const sharedMounts = page.locator('[data-ims-graph="shared"]');
    const modal = page.locator('.calc_modal');
    await expect(sharedMounts).toHaveCount(2);

    const firstMount = sharedMounts.nth(0);
    const secondMount = sharedMounts.nth(1);
    await expect(firstMount.locator('.igc')).toBeVisible();
    await expect(secondMount.locator('.igc')).toBeVisible();

    await fillAndApplyInput(firstMount, 'revenue', '$300', 'blur');
    await fillAndApplyInput(firstMount, 'growth', '4%', 'enter');
    await fillAndApplyInput(firstMount, 'fixed', '$1,700', 'blur');
    await expect(modal).not.toHaveClass(/show/);

    await fillAndApplyInput(secondMount, 'revenue', '$400', 'blur');
    await fillAndApplyInput(secondMount, 'growth', '5%', 'enter');
    await fillAndApplyInput(secondMount, 'fixed', '$1,800', 'blur');
    await expect(modal).toHaveClass(/show/);
  });
});
