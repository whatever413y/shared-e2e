import { expect, test } from '@playwright/test';
import { data, legacyTenantUrl, semanticsText, tenantUrl } from './helpers';

// Runs after 2-admin-flow (files run in name order with one worker) and checks the tenant sees that bill.
test('tenant opens their link, sees the same total, and opens the receipt the admin attached', async ({ page }) => {
  await page.goto(tenantUrl(data.tenant));

  // Flutter web only mirrors a field's text into its accessibility <input> while the field is focused.
  const accountId = page.getByTestId('tenant-account-id').locator('input').first();
  await accountId.focus();
  await expect(accountId).toHaveValue(data.tenant);
  await page.getByTestId('tenant-login-submit').click();

  await expect.poll(() => semanticsText(page.getByTestId('tenant-latest-total'))).toContain(data.expectedTotal);

  // The bill's page (opened from the summary card) has the receipt link; it fetches a signed link, then the
  // image loads from the API's /api/files route.
  await page.getByTestId('tenant-latest-total').click();
  const file = page.waitForResponse((r) => r.url().includes('/api/files/'));
  await page.getByTestId('tenant-receipt-link').click();
  const response = await file;
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toBe('image/webp');
});

test('an unknown account ID is rejected with the existing message', async ({ page }) => {
  await page.goto(tenantUrl('NOBODY HERE'));
  await page.getByTestId('tenant-login-submit').click();

  // Shown under the field (Flutter also announces it to screen readers, hence the scoped locator).
  await expect(page.getByTestId('tenant-account-id').getByText('Account ID not found.')).toBeVisible();
});

test('an old #/ tenant link still prefills the account ID', async ({ page }) => {
  await page.goto(legacyTenantUrl(data.tenant));
  const accountId = page.getByTestId('tenant-account-id').locator('input').first();
  await accountId.focus();
  await expect(accountId).toHaveValue(data.tenant);
});
