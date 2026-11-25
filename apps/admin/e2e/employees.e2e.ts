import { expect, test } from '@playwright/test';
import { readState, stepUpIfAsked } from './support-ui';

const state = readState();
test.use({ storageState: state.personas.admin.storageState });

test('invite an employee, add and revoke a role, and see it in the audit log', async ({ page }) => {
  const email = `e2e-invitee-${state.runId}@matilda.test`;
  await page.goto('/employees');
  await page.getByRole('button', { name: 'Invite employee' }).click();
  const drawer = page.getByRole('dialog', { name: 'Invite employee' });
  await drawer.getByLabel('Full name').fill('E2E Invitee');
  await drawer.getByLabel('Work email').fill(email);
  await drawer.getByLabel('Role', { exact: true }).selectOption({ label: 'Customer Support' });
  await drawer.getByLabel('Brand', { exact: true }).selectOption({ label: 'Matilda Flower' });
  await drawer.getByRole('button', { name: 'Send invitation' }).click();
  await stepUpIfAsked(page);

  await expect(page.getByRole('heading', { name: 'E2E Invitee', level: 1 })).toBeVisible();
  const assignments = page.getByRole('table').first();
  await expect(assignments).toContainText('Customer Support');

  await page.getByRole('button', { name: 'Add role' }).click();
  const add = page.getByRole('dialog', { name: 'Add role' });
  await add.getByLabel('Role', { exact: true }).selectOption({ label: 'Catalog Manager' });
  await add.getByLabel('Brand', { exact: true }).selectOption({ label: 'Matilda Flower' });
  await add.getByRole('button', { name: /^(Add|Assign) role$/ }).click();
  await stepUpIfAsked(page);
  await expect(assignments).toContainText('Catalog Manager');

  await assignments
    .getByRole('row', { name: /Catalog Manager/ })
    .getByRole('button', { name: /revoke/i })
    .click();
  await page.getByRole('button', { name: 'Revoke role' }).click();
  await stepUpIfAsked(page);
  await expect(assignments).not.toContainText('Catalog Manager');

  // The change trail is visible to someone with audit access.
  await page.goto('/audit-log');
  await expect(page.getByRole('table').first()).toContainText('assignment.revoke');
  await page.getByRole('button', { name: 'assignment.revoke' }).first().click();
  await expect(page.getByRole('dialog', { name: 'Audit entry' })).toBeVisible();
});

test('lists, searches and filters employees, and shows customers read-only', async ({ page }) => {
  await page.goto('/employees');
  const table = page.getByRole('table').first();
  await expect(table).toContainText('E2E Super Admin');
  await page.getByLabel('Search employees').fill('Catalog Manager');
  await expect(table).toContainText('E2E Catalog Manager');
  await expect(table).not.toContainText('E2E Super Admin');
  await page.getByLabel('Status', { exact: true }).selectOption('SUSPENDED');
  await expect(page.getByText('No employees match these filters.')).toBeVisible();

  await page.goto('/customers');
  await expect(page.getByRole('heading', { name: 'Customers', level: 1 })).toBeVisible();
  await expect(page.getByRole('button', { name: /invite|new|add|delete/i })).toHaveCount(0);
});
