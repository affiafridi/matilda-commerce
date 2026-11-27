import { expect, test } from '@playwright/test';
import { readState, stepUpIfAsked } from './support-ui';

const state = readState();

test.describe('Super Admin', () => {
  test.use({ storageState: state.personas.admin.storageState });

  test('asks for a brand before showing stock', async ({ page }) => {
    await page.goto('/stock');
    await expect(page.getByRole('heading', { name: 'Stock', level: 1 })).toBeVisible();
    await expect(page.getByText(/choose a brand/i).first()).toBeVisible();
  });

  test('tracks a product at a branch and records a receipt', async ({ page }) => {
    const product = `E2E stock product ${state.runId}`;

    await page.goto('/products');
    await page
      .getByRole('combobox', { name: 'Brand', exact: true })
      .selectOption({ label: 'Matilda Flower' });
    await page.goto('/products/new');
    await page.getByLabel('Name (English)').fill(product);
    await page.getByRole('button', { name: 'Create product' }).click();
    await stepUpIfAsked(page);
    await expect(page.getByRole('heading', { name: product, level: 1 })).toBeVisible();

    await page.goto('/stock');
    await page.getByRole('button', { name: 'Track item' }).click();
    const track = page.getByRole('dialog');
    await track.getByLabel('Branch').selectOption(state.branchId);
    await track.getByLabel('Product').selectOption({ label: product });
    await track.getByRole('button', { name: 'Start tracking' }).click();
    await stepUpIfAsked(page);

    await page.getByRole('button', { name: product }).click();
    const drawer = page.getByRole('dialog');
    await drawer.getByLabel('Units').fill('5');
    await drawer.getByRole('button', { name: 'Record movement' }).click();
    await stepUpIfAsked(page);
    await expect(drawer.getByText('Movement recorded.')).toBeVisible();
    await expect(drawer.getByText('Receipt', { exact: true })).toBeVisible();

    // An adjustment out needs a reason, and cannot take more than is on hand.
    await drawer.getByLabel('Movement').selectOption('ADJUSTMENT_OUT');
    await drawer.getByLabel('Units').fill('1');
    await drawer.getByRole('button', { name: 'Record movement' }).click();
    await expect(page.getByRole('alert').first()).toContainText(/why/i);
  });

  test('sets up a zone, a method, a charge and a slot', async ({ page }) => {
    const suffix = state.runId
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .slice(-8);
    const zone = `E2E zone ${state.runId}`;
    const method = `E2E method ${state.runId}`;

    await page.goto('/delivery/zones');
    await page
      .getByRole('combobox', { name: 'Brand', exact: true })
      .selectOption({ label: 'Matilda Flower' });
    await page.getByRole('button', { name: 'Add zone' }).click();
    let drawer = page.getByRole('dialog');
    await drawer.getByLabel('Name').fill(zone);
    await drawer.getByLabel('Code').fill(`e2e-zone-${suffix}`);
    await drawer.getByRole('button', { name: 'Save zone' }).click();
    await stepUpIfAsked(page);
    await expect(page.getByRole('button', { name: zone })).toBeVisible();

    await page.goto('/delivery/methods');
    await page.getByRole('button', { name: 'Add method' }).click();
    drawer = page.getByRole('dialog');
    await drawer.getByLabel('Name').fill(method);
    await drawer.getByLabel('Code').fill(`e2e-method-${suffix}`);
    await drawer.getByRole('button', { name: 'Save method' }).click();
    await stepUpIfAsked(page);
    await expect(page.getByRole('button', { name: method })).toBeVisible();

    await page.getByRole('button', { name: 'Add charge' }).click();
    drawer = page.getByRole('dialog');
    await drawer.getByLabel('Zone').selectOption({ label: zone });
    await drawer.getByLabel('Method').selectOption({ label: method });
    await drawer.getByLabel(/^Fee/).fill('25');
    await drawer.getByRole('button', { name: 'Save charge' }).click();
    await stepUpIfAsked(page);
    await expect(page.getByRole('table', { name: 'Delivery charges' })).toContainText('25.00');

    await page.goto('/delivery/slots');
    await page.getByRole('button', { name: 'Add slot' }).click();
    drawer = page.getByRole('dialog');
    await drawer.getByLabel('Branch').selectOption(state.branchId);
    await drawer.getByLabel('Day', { exact: true }).selectOption({ label: 'Friday' });
    await drawer.getByLabel('Starts').fill('10:00');
    await drawer.getByLabel('Ends').fill('14:00');
    await drawer.getByRole('button', { name: 'Save slot' }).click();
    await stepUpIfAsked(page);
    await expect(page.getByRole('button', { name: /Friday 10:00–14:00/ })).toBeVisible();
  });

  test('keeps opening hours and closed dates of a branch', async ({ page }) => {
    await page.goto('/delivery/calendar');
    await page
      .getByRole('combobox', { name: 'Brand', exact: true })
      .selectOption({ label: 'Matilda Flower' });
    await page.getByLabel('Monday').fill('09:00-18:00');
    await page.getByRole('button', { name: 'Save opening hours' }).click();
    await stepUpIfAsked(page);
    await expect(page.getByText('Opening hours saved.')).toBeVisible();

    await page.getByLabel('Monday').fill('9 to 6');
    await page.getByRole('button', { name: 'Save opening hours' }).click();
    await expect(page.getByRole('alert').first()).toContainText(/09:00-18:00/);
  });

  test('tests availability and shows the assignment rules', async ({ page }) => {
    await page.goto('/delivery/assignment');
    await page
      .getByRole('combobox', { name: 'Brand', exact: true })
      .selectOption({ label: 'Matilda Flower' });
    await expect(page.getByRole('heading', { name: 'Which branch gets the order' })).toBeVisible();
    await page.getByRole('button', { name: 'Check availability' }).click();
    await expect(page.getByRole('alert').first()).toContainText(/area/i);
  });
});

test.describe('Branch Manager', () => {
  test.use({ storageState: state.personas.branch.storageState });

  test('sees the inventory menu without administration pages', async ({ page }) => {
    await page.goto('/stock');
    const nav = page.getByRole('navigation').first();
    await expect(nav.getByRole('link', { name: 'Stock', exact: true })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Transfers', exact: true })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Audit log' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Request transfer' })).toHaveCount(0);
  });

  test('cannot read another brand through the API', async ({ page }) => {
    await page.goto('/stock');
    const statuses = await page.evaluate(async (other) => {
      const get = async (path: string) =>
        (await fetch(`/api/v1/admin/brands/${other}/${path}`, { credentials: 'same-origin' }))
          .status;
      return [
        await get('inventory/stock'),
        await get('delivery/zones'),
        await get('inventory/transfers'),
      ];
    }, state.otherBrandId);
    expect(statuses).toEqual([403, 403, 403]);
  });
});
