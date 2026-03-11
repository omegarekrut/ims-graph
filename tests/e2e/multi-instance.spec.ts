import { expect, test } from '@playwright/test';

import { fillAndApplyInput, waitForWidgetMount, widgetInput } from './helpers/widget';

test.describe('multi-instance scene behavior', () => {
  test('multiple auto-initialized widgets stay isolated', async ({ page }) => {
    await page.goto('./tests/e2e/fixtures/two-widget-auto-init.html');

    const graphA = await waitForWidgetMount(page, 'graph-a');
    const graphB = await waitForWidgetMount(page, 'graph-b');

    await expect(widgetInput(graphA, 'revenue')).toHaveValue('$200');
    await expect(widgetInput(graphB, 'revenue')).toHaveValue('$900');

    await fillAndApplyInput(graphA, 'revenue', '$3,000', 'blur');

    await expect(widgetInput(graphA, 'revenue')).toHaveValue('$3,000');
    await expect(widgetInput(graphB, 'revenue')).toHaveValue('$900');
  });

  test('dependent graph input remounts from source output propagation', async ({ page }) => {
    await page.goto('./tests/e2e/fixtures/dependency-scene-bootstrap.html');
    await page.waitForFunction(() => typeof window.ImsGrowthCalculator?.initScene === 'function');

    await page.evaluate(() => {
      const runtimeWindow = window as Window & {
        __sceneInstance?: unknown;
      };
      runtimeWindow.__sceneInstance = window.ImsGrowthCalculator?.initScene({
        mount: '#scene-dependency',
        sharedState: {
          sourceRevenueInput: 700,
        },
        graphs: [
          {
            graphId: 'source-graph',
            mount: '[data-ims-graph="source-graph"]',
            inputs: [
              {
                optionKey: 'weeklyRevenue0',
                storeKey: 'sourceRevenueInput',
              },
            ],
            outputs: [
              {
                outputKey: 'weeklyRevenue0',
                storeKey: 'sharedRevenue',
              },
            ],
          },
          {
            graphId: 'target-graph',
            mount: '[data-ims-graph="target-graph"]',
            inputs: [
              {
                optionKey: 'weeklyRevenue0',
                storeKey: 'sharedRevenue',
              },
            ],
            dependsOn: [
              {
                source: {
                  graphId: 'source-graph',
                },
                event: 'graph:output',
                outputKey: 'weeklyRevenue0',
              },
            ],
          },
        ],
      });
    });

    const source = await waitForWidgetMount(page, 'source-graph');
    const target = await waitForWidgetMount(page, 'target-graph');

    await expect(widgetInput(source, 'revenue')).toHaveValue('$700');
    await expect(widgetInput(target, 'revenue')).toHaveValue('$700');

    await page.evaluate(() => {
      const runtimeWindow = window as Window & {
        __sceneInstance?: {
          store?: {
            set: (key: string, value: unknown, sourceGraphId?: string | null) => void;
          } | null;
        };
      };
      runtimeWindow.__sceneInstance?.store?.set('sourceRevenueInput', 850, null);
    });

    await expect(widgetInput(source, 'revenue')).toHaveValue('$850');
    await expect(widgetInput(target, 'revenue')).toHaveValue('$850');
  });
});
