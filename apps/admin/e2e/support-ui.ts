import type { Page } from '@playwright/test';
import { nextCode, readState } from './support';

export { readState };

/**
 * Sensitive changes ask for a fresh two-factor code when the sign-in is older than ten minutes.
 * If the confirmation dialog appears, answer it with the next valid code for the Super Admin.
 */
export async function stepUpIfAsked(page: Page): Promise<void> {
  const dialog = page
    .getByRole('dialog')
    .filter({ hasText: /two-factor|authentication code|confirm it/i });
  const shown = await dialog
    .first()
    .waitFor({ state: 'visible', timeout: 1500 })
    .then(() => true)
    .catch(() => false);
  if (!shown) return;
  await dialog.first().getByLabel(/code/i).fill(nextCode(readState().personas.admin.secret));
  await dialog
    .first()
    .getByRole('button', { name: /confirm|verify|continue/i })
    .click();
}
