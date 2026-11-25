import { expect, test } from '@playwright/test';
import { readState, stepUpIfAsked } from './support-ui';

const state = readState();
test.use({ storageState: state.personas.admin.storageState });

test('create, edit, clone and delete a custom role', async ({ page }) => {
  const name = `E2E role ${state.runId}`;
  await page.goto('/roles');
  await expect(page.getByRole('table', { name: 'Permissions granted by each role' })).toBeVisible();

  await page.getByRole('link', { name: 'New role' }).click();
  await page.getByLabel('Name', { exact: true }).fill(name);
  const boxes = page.getByRole('checkbox');
  await boxes.nth(0).check();
  await boxes.nth(1).check();
  await page.getByRole('button', { name: 'Create role' }).click();
  await stepUpIfAsked(page);
  await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
  await expect(page.getByText('Permissions (2 selected)')).toBeVisible();

  await page.getByRole('checkbox').nth(2).check();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await stepUpIfAsked(page);
  await expect(page.getByText(/Saved\. People holding this role/)).toBeVisible();
  await expect(page.getByText('Permissions (3 selected)')).toBeVisible();

  await page.getByRole('button', { name: 'Clone' }).click();
  await page.getByLabel('Name of the copy').fill(`${name} copy`);
  await page.getByRole('button', { name: 'Create copy' }).click();
  await stepUpIfAsked(page);
  await expect(page.getByRole('heading', { name: `${name} copy`, level: 1 })).toBeVisible();

  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete role' }).click();
  await stepUpIfAsked(page);
  await expect(page).toHaveURL(/\/roles$/);
  await expect(page.getByRole('link', { name: `${name} copy` })).toHaveCount(0);
  await expect(page.getByRole('link', { name, exact: true })).toBeVisible();
});

test('system roles cannot be edited, only cloned', async ({ page }) => {
  await page.goto('/roles');
  await page.getByRole('link', { name: 'Branch Manager' }).click();
  await expect(page.getByText(/System roles are fixed/)).toBeVisible();
  await expect(page.getByLabel('Name', { exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Save changes' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Clone' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Delete', exact: true })).toHaveCount(0);
});
