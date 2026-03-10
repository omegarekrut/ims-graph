import { type Locator, type Page } from '@playwright/test';

export type HandleKey = 'revenue-start' | 'growth' | 'fixed' | 'variable';

export async function dragBy(page: Page, target: Locator, deltaX: number, deltaY: number): Promise<void> {
  const box = await target.boundingBox();
  if (!box) {
    throw new Error('Drag target bounding box is unavailable');
  }

  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + deltaX, startY + deltaY, { steps: 12 });
  await page.mouse.up();
}

export async function dragHandle(page: Page, mount: Locator, handle: HandleKey, deltaX: number, deltaY: number): Promise<void> {
  const target = mount.locator(`svg [data-handle="${handle}"]`).first();
  await dragBy(page, target, deltaX, deltaY);
}
