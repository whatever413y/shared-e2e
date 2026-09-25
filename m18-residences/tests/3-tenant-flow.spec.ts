import { expect, test } from '@playwright/test';
import { data, semanticsText, tenantUrl } from './helpers';

// Runs after 2-admin-flow (files run in name order with one worker) and checks the tenant sees that bill.
test('tenant opens their link, the account ID is prefilled, and the latest bill shows the same total', async ({ page }) => {
  await page.goto(tenantUrl(data.tenant));

  // Flutter web only mirrors a field's text into its accessibility <input> while the field is focused.
  const accountId = page.getByTestId('tenant-account-id').locator('input').first();
  await accountId.focus();
  await expect(accountId).toHaveValue(data.tenant);
  await page.getByTestId('tenant-login-submit').click();

  await expect.poll(() => semanticsText(page.getByTestId('tenant-latest-total'))).toContain(data.expectedTotal);
});

test('an unknown account ID is rejected with the existing message', async ({ page }) => {
  await page.goto(tenantUrl('NOBODY HERE'));
  await page.getByTestId('tenant-login-submit').click();

  // Shown under the field (Flutter also announces it to screen readers, hence the scoped locator).
  await expect(page.getByTestId('tenant-account-id').getByText('Account ID not found.')).toBeVisible();
});
