import { expect, test } from '@playwright/test';

test('preview shell has widget mount', async ({ page }) => {
  await page.goto('./preview-shell.html');
  await expect(page.locator('#ims-growth-calc')).toBeVisible();
});
