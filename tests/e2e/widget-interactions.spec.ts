import { expect, test } from '@playwright/test';

import { dragHandle } from './helpers/drag';
import {
  fillAndApplyInput,
  waitForWidgetMount,
  widgetInput,
  widgetSummary,
} from './helpers/widget';

test.describe('widget interactions', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('./preview-shell.html');
  });

  test('auto-init works and unit/expense toggles update controls', async ({ page }) => {
    const mount = await waitForWidgetMount(page, 'preview-growth');
    const revenueInput = widgetInput(mount, 'revenue');

    await expect(mount.locator('input[data-group="units"][value="week"]')).toBeChecked();
    await expect(mount.locator('input[data-group="expenseViz"][value="bars"]')).toBeChecked();
    await expect(revenueInput).toHaveValue('$100');

    await mount.locator('input[data-group="units"][value="month"]').check();
    await expect(revenueInput).toHaveValue('$435');

    await mount.locator('input[data-group="expenseViz"][value="lines"]').check();
    await expect(mount.locator('input[data-group="expenseViz"][value="lines"]')).toBeChecked();
  });

  test('inputs apply on blur and Enter and refresh KPI values', async ({ page }) => {
    const mount = await waitForWidgetMount(page, 'preview-growth');
    const beforeBreakeven = (await widgetSummary(mount, 'breakeven').textContent()) || '';
    const beforeBillion = (await widgetSummary(mount, 'billion').textContent()) || '';

    await fillAndApplyInput(mount, 'revenue', '$500.49', 'blur');
    await expect(widgetInput(mount, 'revenue')).toHaveValue('$500');

    await fillAndApplyInput(mount, 'growth', '4.00%', 'enter');
    await expect(widgetInput(mount, 'growth')).toHaveValue('4%');

    await fillAndApplyInput(mount, 'grossMargin', '63%', 'blur');
    await expect(widgetInput(mount, 'grossMargin')).toHaveValue('63%');

    await fillAndApplyInput(mount, 'fixed', '$2,300.40', 'enter');
    await expect(widgetInput(mount, 'fixed')).toHaveValue('$2,300');

    const afterBreakeven = (await widgetSummary(mount, 'breakeven').textContent()) || '';
    const afterBillion = (await widgetSummary(mount, 'billion').textContent()) || '';
    expect(afterBreakeven).not.toBe(beforeBreakeven);
    expect(afterBillion).not.toBe(beforeBillion);
  });

  test('drag handles and revenue hover tooltip stay interactive', async ({ page }) => {
    const mount = await waitForWidgetMount(page, 'preview-growth');

    const revenueBefore = await widgetInput(mount, 'revenue').inputValue();
    await dragHandle(page, mount, 'revenue-start', 0, -55);
    const revenueAfter = await widgetInput(mount, 'revenue').inputValue();
    expect(revenueAfter).not.toBe(revenueBefore);

    const growthBefore = await widgetInput(mount, 'growth').inputValue();
    await dragHandle(page, mount, 'growth', 80, -35);
    const growthAfter = await widgetInput(mount, 'growth').inputValue();
    expect(growthAfter).not.toBe(growthBefore);

    const fixedBefore = await widgetInput(mount, 'fixed').inputValue();
    await dragHandle(page, mount, 'fixed', 0, -45);
    const fixedAfter = await widgetInput(mount, 'fixed').inputValue();
    expect(fixedAfter).not.toBe(fixedBefore);

    await fillAndApplyInput(mount, 'grossMargin', '80%', 'blur');
    await expect(widgetInput(mount, 'grossMargin')).toHaveValue('80%');
    const grossMarginBefore = await widgetInput(mount, 'grossMargin').inputValue();
    await dragHandle(page, mount, 'variable', 0, 45);
    const grossMarginAfter = await widgetInput(mount, 'grossMargin').inputValue();
    expect(grossMarginAfter).not.toBe(grossMarginBefore);

    const revenueHit = mount.locator('svg polyline[style*="cursor:help"]').first();
    const hitBox = await revenueHit.boundingBox();
    expect(hitBox).not.toBeNull();
    if (!hitBox) {
      return;
    }

    await page.mouse.move(hitBox.x + hitBox.width / 2, hitBox.y + hitBox.height / 2);
    await expect(
      mount
        .locator('svg text')
        .filter({ hasText: /^Revenue \$/ })
        .first()
    ).toBeVisible();
  });
});
