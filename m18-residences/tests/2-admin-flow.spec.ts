import { expect, type Locator, type Page, type Response, test } from '@playwright/test';
import { admin } from '../env.mjs';
import { adminHome, data, loginAsAdmin, loginAsTenant, noisePng, openPage, pickOption, semanticsText, showing, typeInto } from './helpers';

// One admin session builds the data the tenant spec checks: room → tenant → reading → bill.
test.describe.configure({ mode: 'serial' });

test('admin creates a room, tenant, reading and a bill with a payment, the tenant replaces the payment, the admin attaches and replaces the WebP receipt, removes the payment, and replaces a payment QR code', async ({
  page,
  browser,
}) => {
  await loginAsAdmin(page, admin.username, admin.password);
  await expect(adminHome(page)).toBeVisible();

  await test.step('room', async () => {
    await openPage(page, 'Rooms');
    await page.getByRole('button', { name: 'New Room' }).click();
    await typeInto(page, 'room-name', data.room);
    await typeInto(page, 'room-rent', data.rent);
    await page.getByTestId('room-save').click();
    await expect(showing(page, data.room)).toBeVisible();
  });

  await test.step('tenant', async () => {
    await openPage(page, 'Tenants');
    await page.getByRole('button', { name: 'New Tenant' }).click();
    await typeInto(page, 'tenant-name', data.tenant);
    await pickOption(page, 'tenant-room', data.room);
    await page.getByTestId('tenant-save').click();
    await expect(showing(page, data.tenant)).toBeVisible();
  });

  await test.step('reading', async () => {
    await openPage(page, 'Electric Readings');
    await page.getByRole('button', { name: 'New Reading' }).click();
    await pickOption(page, 'reading-room', data.room);
    await pickOption(page, 'reading-tenant', data.tenant);
    await typeInto(page, 'reading-prev', data.prevReading);
    await typeInto(page, 'reading-curr', data.currReading);
    await page.getByTestId('reading-save').click();
    await expect(showing(page, data.tenant)).toBeVisible();
  });

  /** Picks [photo] with the `bill-attach-<kind>` button and waits until it is converted to WebP. */
  async function attachFile(kind: 'receipt' | 'payment', photo: Buffer, name: string) {
    const chooser = page.waitForEvent('filechooser');
    await page.getByTestId(`bill-attach-${kind}`).click();
    await (await chooser).setFiles({ name: `${name}.png`, mimeType: 'image/png', buffer: photo });
    // Shrunk to 1600 px and re-encoded as WebP before upload; the dialog shows the new name and size.
    await expect.poll(() => semanticsText(page.getByTestId(`bill-${kind}-file`))).toContain(`${name}.webp`);
  }

  /** Checks an upload request went up as WebP, much smaller than [photo], and returns the bill it answered. */
  async function sentAsWebp(response: Response, photo: Buffer) {
    expect(response.status()).toBe(200);
    const sent = response.request().postDataBuffer() ?? Buffer.alloc(0);
    expect(sent.includes(Buffer.from('Content-Type: image/webp', 'utf8')) || sent.includes(Buffer.from('content-type: image/webp', 'utf8'))).toBe(true);
    expect(sent.length).toBeLessThan(photo.length / 2);
    return response.json();
  }

  /** Saves the bill dialog and checks the receipt went up as WebP; returns the bill. */
  async function saveWithReceipt(photo: Buffer) {
    const upload = page.waitForResponse((r) => r.url().endsWith('/upload') && r.request().method() === 'PUT');
    await page.getByTestId('bill-save').click();
    const bill = await sentAsWebp(await upload, photo);
    expect(bill.bill.paid).toBe(true);
    expect(bill.bill.receipt_url).toMatch(/^\d+-r\d+$/);
    return bill;
  }

  const status = () => semanticsText(page.getByTestId(`bill-status-${data.tenant}`));

  let firstPayment = '';
  await test.step('bill with the tenant\'s payment, in one go', async () => {
    await openPage(page, 'Billing');
    // The button is disabled until the billing data has loaded; the (still empty) list shows it has.
    await expect(showing(page, 'No bills found')).toBeVisible();
    await page.getByRole('button', { name: 'Generate New Bill' }).click();
    // Generating a bill takes the tenant's room.
    await pickOption(page, 'bill-tenant', data.tenant);
    // Room charges (the room's rent) and electric charges (50 kWh × rate 17) fill in by themselves and are
    // read-only; the form starts with one empty additional-charge row.
    await typeInto(page, 'bill-charge-amount-0', data.charge.amount);
    await typeInto(page, 'bill-charge-description-0', data.charge.description);
    const photo = noisePng(2000, 1500); // ~9 MB as PNG
    await attachFile('payment', photo, 'payment');
    // The bill is created, then the payment uploaded to it: no second pass through the dialog.
    const upload = page.waitForResponse((r) => r.url().endsWith('/payment') && r.request().method() === 'PUT');
    await page.getByTestId('bill-save').click();
    const bill = await sentAsWebp(await upload, photo);
    expect(bill.bill.paid).toBe(false);
    expect(bill.bill.receipt_url).toBeNull();
    expect(bill.bill.payment_url).toMatch(/^\d+-r\d+$/);
    firstPayment = bill.bill.payment_url;

    await expect.poll(() => semanticsText(page.getByTestId(`bill-total-${data.tenant}`))).toContain(data.expectedTotal);
    await expect.poll(status).toContain('For verification');
    // Files show as View buttons, never as storage keys or links.
    await expect(showing(page, firstPayment)).toHaveCount(0);
  });

  await test.step('the tenant replaces the payment on a phone', async () => {
    // Payment names have one-second resolution; make sure the new one differs from the first.
    await page.waitForTimeout(1_100);
    const tenant = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await loginAsTenant(tenant);
    await tenant.getByTestId('tenant-latest-total').click();
    await expect.poll(() => semanticsText(tenant.getByTestId('tenant-bill-status'))).toContain('For verification');
    await expect(tenant.getByTestId('tenant-receipt-link')).toHaveCount(0);

    const photo = noisePng(1800, 1200);
    const chooser = tenant.waitForEvent('filechooser');
    await tenant.getByTestId('tenant-upload-payment').click();
    const upload = tenant.waitForResponse((r) => r.url().endsWith('/payment') && r.request().method() === 'PUT');
    await (await chooser).setFiles({ name: 'gcash-screenshot.png', mimeType: 'image/png', buffer: photo });
    const bill = await sentAsWebp(await upload, photo);
    expect(bill.bill.payment_url).not.toBe(firstPayment);
    await expect(showing(tenant, 'Payment uploaded.')).toBeVisible();

    // The tenant's own payment opens in the preview.
    const file = tenant.waitForResponse((r) => r.url().includes('/api/files/tenant-payments/'));
    await tenant.getByTestId('tenant-payment-link').click();
    expect((await file).headers()['content-type']).toBe('image/webp');
    await tenant.getByTestId('signed-file-close').click();
    await tenant.close();
  });

  let firstReceipt = '';
  await test.step('the admin sees the payment, then attaches the receipt', async () => {
    await page.getByRole('button', { name: 'Refresh' }).click();
    await page.getByTestId(`bill-total-${data.tenant}`).click();
    await expect.poll(() => semanticsText(page.getByTestId('bill-details-status'))).toContain('For verification');
    const file = page.waitForResponse((r) => r.url().includes('/api/files/tenant-payments/'));
    await page.getByTestId('bill-view-payment').getByRole('button', { name: 'View payment' }).click();
    expect((await file).status()).toBe(200);
    await page.getByTestId('signed-file-close').click();
    // The preview's own Close button is also named "Close": wait until it is gone before closing the details.
    await expect(page.getByTestId('signed-file-close')).toHaveCount(0);
    await page.getByRole('button', { name: 'Close' }).click();
    await expect(page.getByTestId('bill-details-status')).toHaveCount(0);

    await page.getByTestId(`bill-edit-${data.tenant}`).click();
    const photo = noisePng(2000, 1500);
    await attachFile('receipt', photo, 'receipt');
    const bill = await saveWithReceipt(photo);
    expect(bill.bill.payment_url).not.toBeNull();
    firstReceipt = bill.bill.receipt_url;
    await expect.poll(status).toContain('Paid');
  });

  await test.step('replace the receipt', async () => {
    // Receipt names have one-second resolution; make sure the new one differs from the first.
    await page.waitForTimeout(1_100);
    await page.getByTestId(`bill-edit-${data.tenant}`).click();
    const photo = noisePng(1800, 1200);
    await attachFile('receipt', photo, 'receipt-2');
    const bill = await saveWithReceipt(photo);
    expect(bill.bill.receipt_url).not.toBe(firstReceipt);
    await expect.poll(status).toContain('Paid');
  });

  await test.step('remove the payment in Update Bill', async () => {
    // Billing Details only views; the Update Bill form attaches, changes and removes the receipt and the payment.
    await page.getByTestId(`bill-total-${data.tenant}`).click();
    await expect(page.getByTestId('bill-details-status')).toBeVisible();
    await expect(page.getByTestId('bill-remove-payment')).toHaveCount(0);
    await expect(page.getByTestId('bill-attach-payment')).toHaveCount(0);
    await page.getByRole('button', { name: 'Close' }).click();
    await expect(page.getByTestId('bill-details-status')).toHaveCount(0);

    await page.getByTestId(`bill-edit-${data.tenant}`).click();
    await expect(page.getByTestId('bill-remove-receipt')).toBeVisible();
    await page.getByTestId('bill-remove-payment').click();
    const cleared = page.waitForResponse((r) => r.url().endsWith('/payment') && r.request().method() === 'DELETE');
    await page.getByTestId('bill-save').click();
    const response = await cleared;
    expect(response.status()).toBe(200);
    const bill = await response.json();
    expect(bill.bill.payment_url).toBeNull();
    expect(bill.bill.paid).toBe(true);
    await expect.poll(status).toContain('Paid');
  });

  await test.step('payment QR code', async () => {
    await openPage(page, 'Payment QR Codes');
    const chooser = page.waitForEvent('filechooser');
    await page.getByTestId('payment-replace-gcash').click();
    const upload = page.waitForResponse((r) => r.url().endsWith('/api/payments/gcash') && r.request().method() === 'PUT');
    await (await chooser).setFiles({ name: 'gcash.png', mimeType: 'image/png', buffer: noisePng(300, 300) });
    // Converted to PNG in the browser (the server takes nothing else).
    const response = await upload;
    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual({ name: 'gcash', key: 'payments/gcash.png', exists: true });
    await expect(showing(page, 'GCash QR code replaced')).toBeVisible();
  });
});

test.describe('copying', () => {
  test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

  /** Drags across [target] with the mouse, presses Ctrl/Cmd+C and returns the clipboard. */
  async function dragCopy(page: Page, target: Locator): Promise<string> {
    const box = (await target.boundingBox())!;
    await page.evaluate(() => navigator.clipboard.writeText(''));
    await page.mouse.move(box.x + 1, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 1, box.y + box.height / 2, { steps: 10 });
    await page.mouse.up();
    await page.keyboard.press('ControlOrMeta+c');
    await page.waitForTimeout(300);
    return page.evaluate(() => navigator.clipboard.readText());
  }

  test('a bill row opens its details, whose text can be copied; the table itself is not selectable', async ({ page }) => {
    await loginAsAdmin(page, admin.username, admin.password);
    await openPage(page, 'Billing');
    const total = page.getByTestId(`bill-total-${data.tenant}`);
    await expect.poll(() => semanticsText(total)).toContain(data.expectedTotal);

    expect(await dragCopy(page, total)).toBe('');

    await total.click();
    const detailsTotal = page.getByTestId('bill-details-total');
    await expect(detailsTotal).toBeVisible();
    expect(await dragCopy(page, detailsTotal)).toContain(data.expectedTotal);
  });
});
