import { expect, test } from '@playwright/test';
import { readState } from './support';

const state = readState();

test.describe('Super Admin', () => {
  test.use({ storageState: state.personas.admin.storageState });

  test('can switch between all brands and one brand', async ({ page }) => {
    await page.goto('/brands');
    const rows = page.getByRole('table').first().getByRole('row');
    await expect(rows.nth(2)).toBeVisible();
    const all = await rows.count();

    const brand = page.getByRole('combobox', { name: 'Brand', exact: true });
    await expect(brand.locator('option', { hasText: 'All brands' })).toHaveCount(1);
    await brand.selectOption({ label: 'Matilda Flower' });
    await expect(rows).toHaveCount(2);

    await brand.selectOption({ label: 'All brands' });
    await expect(rows).toHaveCount(all);
  });
});

test.describe('Branch Manager', () => {
  test.use({ storageState: state.personas.branch.storageState });

  test('is limited to one branch in the interface and in the API', async ({ page }) => {
    await page.goto('/branches');
    const brand = page.getByRole('combobox', { name: 'Brand', exact: true });
    await expect(brand).toBeDisabled();
    await expect(brand).toHaveValue(state.brandId);
    await expect(page.getByRole('combobox', { name: 'Branch', exact: true })).toBeDisabled();
    await expect(brand.locator('option', { hasText: 'All brands' })).toHaveCount(0);

    const table = page.getByRole('table').first();
    await expect(table.getByRole('row')).toHaveCount(2);
    await expect(table).toContainText('Dubai');

    const nav = page.getByRole('navigation').first();
    for (const hidden of [/roles/i, /audit/i, /brands/i]) {
      await expect(nav.getByRole('link', { name: hidden })).toHaveCount(0);
    }

    // The server refuses a brand the person has no grant for, whatever the browser sends.
    const forged = await page.request.get('/api/v1/admin/me/context', {
      headers: { 'X-Admin-Brand': state.otherBrandId },
    });
    expect(forged.status()).toBe(403);
    const own = await page.request.get('/api/v1/admin/me/context', {
      headers: { 'X-Admin-Brand': state.brandId },
    });
    expect(own.status()).toBe(200);
    const roles = await page.request.get('/api/v1/admin/roles');
    expect(roles.status()).toBe(403);
  });
});

test.describe('Catalog Manager', () => {
  test.use({ storageState: state.personas.catalog.storageState });

  test('sees no administration or platform items', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /E2E Catalog Manager/ })).toBeVisible();
    const nav = page.getByRole('navigation').first();
    for (const hidden of [/employees/i, /roles/i, /audit/i, /brands/i]) {
      await expect(nav.getByRole('link', { name: hidden })).toHaveCount(0);
    }
    const audit = await page.request.get('/api/v1/admin/audit');
    expect(audit.status()).toBe(403);
  });
});
