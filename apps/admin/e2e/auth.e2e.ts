import { expect, test } from '@playwright/test';
import { password, nextCode, readState } from './support';

test('signed-out visitors are sent to sign in and back to where they were going', async ({
  page,
}) => {
  await page.goto('/brands');
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fbrands/);
  await expect(page.getByRole('heading', { name: 'Sign in to Matilda Commerce' })).toBeVisible();
});

test('sign in with two-factor, then sign out', async ({ page }) => {
  const user = readState().personas.signin;
  await page.goto('/sign-in');

  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Password', { exact: true }).fill('not-the-password');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('alert').filter({ hasText: /\S/ })).toContainText('incorrect');

  await page.getByLabel('Password', { exact: true }).fill(password());
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: /6-digit code/ })).toBeVisible();

  await page.getByRole('textbox', { name: 'Authentication code' }).fill('000000');
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page.getByRole('alert').filter({ hasText: /\S/ })).toBeVisible();

  await page.getByRole('textbox', { name: 'Authentication code' }).fill(nextCode(user.secret));
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page.getByRole('heading', { name: new RegExp(user.fullName) })).toBeVisible();

  await page.getByRole('button', { name: user.fullName }).click();
  await page.getByRole('button', { name: /sign out/i }).click();
  await expect(page).toHaveURL(/\/sign-in/);
  await page.goto('/');
  await expect(page).toHaveURL(/\/sign-in/);
});
