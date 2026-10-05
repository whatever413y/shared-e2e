import { expect, test } from '@playwright/test';
import { admin } from '../env.mjs';
import { data, loginAsAdmin, noisePng, pickOption, semanticsText, showing, typeInto } from './helpers';

// One admin session builds the data the tenant spec checks: room → tenant → reading → bill.
test.describe.configure({ mode: 'serial' });

test('admin creates a room, tenant, reading and a bill with a WebP receipt, replaces the receipt and a payment QR code', async ({ page }) => {
  await loginAsAdmin(page, admin.username, admin.password);
  await expect(showing(page, 'Welcome Admin!')).toBeVisible();

  await test.step('room', async () => {
    await page.getByRole('button', { name: 'Rooms' }).click();
    await page.getByRole('button', { name: 'New Room' }).click();
    await typeInto(page, 'room-name', data.room);
    await typeInto(page, 'room-rent', data.rent);
    await page.getByTestId('room-save').click();
    await expect(showing(page, data.room)).toBeVisible();
    await page.getByRole('button', { name: 'Back' }).click();
  });

  await test.step('tenant', async () => {
    await page.getByRole('button', { name: 'Tenants' }).click();
    await page.getByRole('button', { name: 'New Tenant' }).click();
    await typeInto(page, 'tenant-name', data.tenant);
    await pickOption(page, 'tenant-room', data.room);
    await page.getByTestId('tenant-save').click();
    await expect(showing(page, data.tenant)).toBeVisible();
    await page.getByRole('button', { name: 'Back' }).click();
  });

  await test.step('reading', async () => {
    await page.getByRole('button', { name: 'Electric Readings' }).click();
    await page.getByRole('button', { name: 'New Reading' }).click();
    await pickOption(page, 'reading-room', data.room);
    await pickOption(page, 'reading-tenant', data.tenant);
    await typeInto(page, 'reading-prev', data.prevReading);
    await typeInto(page, 'reading-curr', data.currReading);
    await page.getByTestId('reading-save').click();
    await expect(showing(page, data.tenant)).toBeVisible();
    await page.getByRole('button', { name: 'Back' }).click();
  });

  /** Picks [photo] with the bill dialog's receipt button and waits until it is converted to WebP. */
  async function attachReceipt(photo: Buffer, name: string) {
    const chooser = page.waitForEvent('filechooser');
    await page.getByTestId('bill-attach-receipt').click();
    await (await chooser).setFiles({ name: `${name}.png`, mimeType: 'image/png', buffer: photo });
    // Shrunk to 1600 px and re-encoded as WebP before upload; the dialog shows the new name and size.
    await expect.poll(() => semanticsText(page.getByTestId('bill-receipt-file'))).toContain(`${name}.webp`);
  }

  /** Saves the bill dialog and checks the receipt went up as WebP, much smaller than [photo]; returns the bill. */
  async function saveWithReceipt(photo: Buffer) {
    const upload = page.waitForResponse((r) => r.url().endsWith('/upload') && r.request().method() === 'PUT');
    await page.getByTestId('bill-save').click();
    const response = await upload;
    expect(response.status()).toBe(200);
    const sent = response.request().postDataBuffer() ?? Buffer.alloc(0);
    expect(sent.includes(Buffer.from('Content-Type: image/webp', 'utf8')) || sent.includes(Buffer.from('content-type: image/webp', 'utf8'))).toBe(true);
    expect(sent.length).toBeLessThan(photo.length / 2);
    const bill = await response.json();
    expect(bill.bill.paid).toBe(true);
    expect(bill.bill.receipt_url).toMatch(/^\d+-r\d+$/);
    return bill;
  }

  let firstReceipt = '';
  await test.step('bill with its receipt, in one go', async () => {
    await page.getByRole('button', { name: 'Billing' }).click();
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
    await attachReceipt(photo, 'receipt');
    // The bill is created, then the receipt uploaded to it: no second pass through the dialog.
    const bill = await saveWithReceipt(photo);
    firstReceipt = bill.bill.receipt_url;

    await expect.poll(() => semanticsText(page.getByTestId(`bill-total-${data.tenant}`))).toContain(data.expectedTotal);
    // The admin sees the receipt's whole storage key.
    await expect(showing(page, `receipts/${data.tenant}/${firstReceipt}`)).toBeVisible();
  });

  await test.step('replace the receipt', async () => {
    // Receipt names have one-second resolution; make sure the new one differs from the first.
    await page.waitForTimeout(1_100);
    await page.getByTestId(`bill-edit-${data.tenant}`).click();
    const photo = noisePng(1800, 1200);
    await attachReceipt(photo, 'receipt-2');
    const bill = await saveWithReceipt(photo);
    expect(bill.bill.receipt_url).not.toBe(firstReceipt);
    await expect(showing(page, `receipts/${data.tenant}/${bill.bill.receipt_url}`)).toBeVisible();
    await page.getByRole('button', { name: 'Back' }).click();
  });

  await test.step('payment QR code', async () => {
    await page.getByRole('button', { name: 'Payment QR Codes' }).click();
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
