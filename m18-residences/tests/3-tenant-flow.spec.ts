import { expect, test } from '@playwright/test';
import { data, legacyTenantUrl, openPage, semanticsText, tenantUrl } from './helpers';

// Runs after 2-admin-flow (files run in name order with one worker) and checks the tenant sees that bill.
test('tenant opens their link, sees the same total and Paid, and opens the receipt the admin attached', async ({ page }) => {
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
  // Paid (the admin attached a receipt): the payment can no longer be changed (the admin removed it at the end).
  await expect.poll(() => semanticsText(page.getByTestId('tenant-bill-status'))).toContain('Paid');
  await expect(page.getByTestId('tenant-upload-payment')).toHaveCount(0);
  await expect(page.getByTestId('tenant-payment-link')).toHaveCount(0);
  const file = page.waitForResponse((r) => r.url().includes('/api/files/receipts/'));
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

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('Enter logs in, the account ID is remembered, receipts and QR codes can be saved, and the × forgets the ID', async ({ page }) => {
    await page.goto(tenantUrl(data.tenant));
    const accountId = page.getByTestId('tenant-account-id').locator('input').first();
    await accountId.focus();
    await expect(accountId).toHaveValue(data.tenant);
    // "Remember me" is off by default (it was on before; check() leaves a ticked box ticked).
    await page.getByTestId('tenant-remember-me').getByRole('checkbox').check();
    await accountId.focus();
    await page.keyboard.press('Enter');
    await expect.poll(() => semanticsText(page.getByTestId('tenant-latest-total'))).toContain(data.expectedTotal);

    // Remembered: after logging out, a visit without a name in the link fills the account ID in.
    await page.getByRole('button', { name: 'Logout' }).click();
    await expect(page.getByTestId('tenant-login-submit')).toBeVisible();
    await page.goto(tenantUrl(''));
    await accountId.focus();
    await expect(accountId).toHaveValue(data.tenant);
    await page.keyboard.press('Enter');

    // The receipt (stored as WebP) is saved as a JPEG.
    await page.getByTestId('tenant-latest-total').click();
    await page.getByTestId('tenant-receipt-link').click();
    const receipt = page.waitForEvent('download');
    await page.getByTestId('signed-file-save').click();
    const saved = (await receipt).suggestedFilename();
    expect(saved.startsWith(`receipt-${data.tenant}-`)).toBe(true);
    expect(saved).toMatch(/-\d+-r\d+\.jpg$/);
    await page.getByTestId('signed-file-close').click();
    // Taps during a dialog's or page's closing animation can be lost: wait until each is gone.
    await expect(page.getByTestId('signed-file-close')).toHaveCount(0);
    await page.getByRole('button', { name: 'Back' }).click();
    await expect(page.getByTestId('tenant-bill-status')).toHaveCount(0);

    // The QR code the admin uploaded, saved as the PNG it is.
    await openPage(page, 'Pay');
    await expect(page.getByTestId('tenant-payment-gcash')).toBeVisible();
    // Each upload gets a new key: payments/<id>-<unix ms>.png.
    const qr = page.waitForResponse((r) => /\/api\/files\/payments\/\d+-\d+\.png/.test(r.url()));
    await page.getByTestId('tenant-payment-gcash').click();
    expect((await qr).status()).toBe(200);
    const download = page.waitForEvent('download');
    await page.getByTestId('signed-file-save').click();
    expect((await download).suggestedFilename()).toBe('m18-gcash-qr.png');
    await page.getByTestId('signed-file-close').click();
    await expect(page.getByTestId('signed-file-close')).toHaveCount(0);

    // A method the admin added: no bundled logo (a tile with its name), its account shown with a copy button.
    const added = page.getByTestId(`tenant-payment-${data.paymentMethod.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`);
    await expect(added).toBeVisible();
    await expect.poll(() => semanticsText(added)).toContain(data.paymentMethod.newAccountNumber);
    await expect(added.getByRole('button', { name: 'Copy account number' })).toBeVisible();

    // The × in the Account ID box clears the field and forgets the remembered ID.
    await page.getByRole('button', { name: 'Logout' }).click();
    await expect(page.getByTestId('tenant-login-submit')).toBeVisible();
    await page.goto(tenantUrl(''));
    await accountId.focus();
    await expect(accountId).toHaveValue(data.tenant);
    await page.getByTestId('tenant-forget-account').click();
    await accountId.focus();
    await expect(accountId).toHaveValue('');
    await expect(page.getByTestId('tenant-remember-me').getByRole('checkbox')).not.toBeChecked();
    await page.goto(tenantUrl(''));
    await accountId.focus();
    await expect(accountId).toHaveValue('');
  });
});
