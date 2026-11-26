import { expect, test } from '@playwright/test';
import { readState, stepUpIfAsked } from './support-ui';

const state = readState();

test.describe('Super Admin', () => {
  test.use({ storageState: state.personas.admin.storageState });

  test('asks for a brand before showing brand catalog data', async ({ page }) => {
    await page.goto('/products');
    await expect(page.getByRole('heading', { name: 'Products', level: 1 })).toBeVisible();
    await expect(page.getByText(/choose a brand/i).first()).toBeVisible();
  });

  test('creates a tag and a draft product inside one brand', async ({ page }) => {
    const tag = `E2E tag ${state.runId}`;
    const product = `E2E product ${state.runId}`;

    await page.goto('/tags');
    await page
      .getByRole('combobox', { name: 'Brand', exact: true })
      .selectOption({ label: 'Matilda Flower' });
    await page.getByRole('button', { name: 'New tag' }).click();
    const drawer = page.getByRole('dialog');
    await drawer.getByLabel('Name (English)').fill(tag);
    await drawer.getByRole('button', { name: 'Create tag' }).click();
    await stepUpIfAsked(page);
    await expect(page.getByRole('button', { name: tag })).toBeVisible();

    await page.goto('/products/new');
    await page.getByLabel('Name (English)').fill(product);
    await page.getByRole('button', { name: 'Create product' }).click();
    await stepUpIfAsked(page);
    await expect(page.getByRole('heading', { name: product, level: 1 })).toBeVisible();
    await expect(page.getByRole('tablist', { name: 'Product sections' })).toBeVisible();
    for (const name of ['Details', 'Content', 'Organise', 'Pricing', 'Media']) {
      await expect(page.getByRole('tab', { name })).toBeVisible();
    }
    // A draft with no market or price cannot be published.
    await page.getByRole('button', { name: 'Publish' }).click();
    await stepUpIfAsked(page);
    await expect(page.getByRole('alert').first()).toBeVisible();

    await page.goto('/products');
    await page.getByLabel('Search products').fill(product);
    await expect(page.getByRole('link', { name: product })).toBeVisible();
  });
});

test.describe('Catalog Manager', () => {
  test.use({ storageState: state.personas.catalog.storageState });

  test('works in one brand only and sees the catalog menu', async ({ page }) => {
    await page.goto('/products');
    const brand = page.getByRole('combobox', { name: 'Brand', exact: true });
    await expect(brand).toBeDisabled();
    await expect(brand).toHaveValue(state.brandId);
    const nav = page.getByRole('navigation').first();
    for (const name of ['Products', 'Categories', 'Collections', 'Tags', 'Attributes']) {
      await expect(nav.getByRole('link', { name, exact: true })).toBeVisible();
    }
    await expect(nav.getByRole('link', { name: 'Media library' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'New product' }).first()).toBeVisible();
  });

  test('cannot read another brand through the API', async ({ page }) => {
    await page.goto('/products');
    const status = await page.evaluate(async (other) => {
      const res = await fetch(`/api/v1/admin/brands/${other}/catalog/products`, {
        credentials: 'same-origin',
      });
      return res.status;
    }, state.otherBrandId);
    expect(status).toBe(403);
  });
});

test.describe('Branch Manager', () => {
  test.use({ storageState: state.personas.branch.storageState });

  test('has no catalog menu', async ({ page }) => {
    await page.goto('/branches');
    const nav = page.getByRole('navigation').first();
    await expect(nav.getByRole('link', { name: 'Products', exact: true })).toHaveCount(0);
    await expect(nav.getByRole('link', { name: 'Media library' })).toHaveCount(0);
  });
});
