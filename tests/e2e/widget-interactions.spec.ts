import type { Locator } from '@playwright/test';
import { expect, test } from '@playwright/test';

import { dragHandle } from './helpers/drag';
import {
  fillAndApplyInput,
  waitForWidgetMount,
  widgetInput,
  widgetSummary,
} from './helpers/widget';

async function readRevenueGeometry(mount: Locator): Promise<{
  pointCount: number;
  uniqueYCount: number;
}> {
  const revenueLine = mount.locator('svg polyline[stroke="#63C56B"]').first();
  await expect(revenueLine).toBeVisible();
  return revenueLine.evaluate((node) => {
    const points = (node.getAttribute('points') || '').trim();
    const yValues = points
      .split(/\s+/)
      .map((point) => point.split(','))
      .map((pair) => Number.parseFloat(pair[1] ?? ''))
      .filter((value) => Number.isFinite(value));

    return {
      pointCount: yValues.length,
      uniqueYCount: new Set(yValues.map((y) => y.toFixed(4))).size,
    };
  });
}

async function readVariableBarGeometry(mount: Locator): Promise<{
  barCount: number;
  hasVisibleBars: boolean;
}> {
  return mount
    .locator('svg')
    .first()
    .evaluate((svg) => {
      const variableRects = Array.from(
        svg.querySelectorAll('rect[fill="#E6A7BC"]')
      ) as SVGRectElement[];
      const heights = variableRects
        .map((rect) => Number.parseFloat(rect.getAttribute('height') || '0'))
        .filter((value) => Number.isFinite(value));

      return {
        barCount: variableRects.length,
        hasVisibleBars: heights.some((value) => value > 0.1),
      };
    });
}

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
    const fundingSummary = widgetSummary(mount, 'funding');
    const beforeFunding = (await fundingSummary.textContent()) || '';
    expect(beforeFunding.startsWith('$')).toBe(true);

    await fundingSummary.evaluate((node) => {
      node.textContent = '__stale_funding__';
    });
    await expect(fundingSummary).toHaveText('__stale_funding__');

    await fillAndApplyInput(mount, 'revenue', '$500.49', 'blur');
    await expect(widgetInput(mount, 'revenue')).toHaveValue('$500');
    await expect(fundingSummary).not.toHaveText('__stale_funding__');
    await expect(fundingSummary).not.toHaveText('-');

    await fillAndApplyInput(mount, 'growth', '4.00%', 'enter');
    await expect(widgetInput(mount, 'growth')).toHaveValue('4%');

    await fillAndApplyInput(mount, 'grossMargin', '63%', 'blur');
    await expect(widgetInput(mount, 'grossMargin')).toHaveValue('63%');

    await fillAndApplyInput(mount, 'fixed', '$2,300.40', 'enter');
    await expect(widgetInput(mount, 'fixed')).toHaveValue('$2,300');

    const afterBreakeven = (await widgetSummary(mount, 'breakeven').textContent()) || '';
    const afterBillion = (await widgetSummary(mount, 'billion').textContent()) || '';
    const afterFunding = (await fundingSummary.textContent()) || '';
    expect(afterBreakeven).not.toBe(beforeBreakeven);
    expect(afterBillion).not.toBe(beforeBillion);
    expect(afterFunding.startsWith('$')).toBe(true);
    expect(afterFunding).not.toBe(beforeFunding);
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

  test('low-revenue flow keeps non-zero chart geometry in bars and lines modes', async ({
    page,
  }) => {
    const mount = await waitForWidgetMount(page, 'preview-growth');

    await mount.locator('input[data-group="units"][value="year"]').check();
    await fillAndApplyInput(mount, 'revenue', '$999', 'blur');
    await fillAndApplyInput(mount, 'growth', '12%', 'blur');
    await fillAndApplyInput(mount, 'grossMargin', '10%', 'blur');
    await fillAndApplyInput(mount, 'fixed', '$300', 'blur');

    await mount.locator('input[data-group="expenseViz"][value="bars"]').check();
    const barsRevenueGeometry = await readRevenueGeometry(mount);
    expect(barsRevenueGeometry.pointCount).toBeGreaterThan(2);
    expect(barsRevenueGeometry.uniqueYCount).toBeGreaterThan(1);

    const barsVariableGeometry = await readVariableBarGeometry(mount);
    expect(barsVariableGeometry.barCount).toBeGreaterThan(0);
    expect(barsVariableGeometry.hasVisibleBars).toBe(true);

    await mount.locator('input[data-group="expenseViz"][value="lines"]').check();
    const linesRevenueGeometry = await readRevenueGeometry(mount);
    expect(linesRevenueGeometry.pointCount).toBeGreaterThan(2);
    expect(linesRevenueGeometry.uniqueYCount).toBeGreaterThan(1);
  });
});
