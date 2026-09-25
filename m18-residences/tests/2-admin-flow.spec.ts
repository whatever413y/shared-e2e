import { expect, test } from '@playwright/test';
import { admin } from '../env.mjs';
import { data, loginAsAdmin, pickOption, semanticsText, showing, typeInto } from './helpers';

// One admin session builds the data the tenant spec checks: room → tenant → reading → bill.
test.describe.configure({ mode: 'serial' });

test('admin creates a room, tenant, reading and bill; the bill total is computed by the server', async ({ page }) => {
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

  await test.step('bill', async () => {
    await page.getByRole('button', { name: 'Billing' }).click();
    await page.getByRole('button', { name: 'Generate New Bill' }).click();
    await pickOption(page, 'bill-tenant', data.tenant);
    // Room charges (the room's rent) and electric charges (50 kWh × rate 17) fill in by themselves and are
    // read-only; the form starts with one empty additional-charge row.
    await typeInto(page, 'bill-charge-amount-0', data.charge.amount);
    await typeInto(page, 'bill-charge-description-0', data.charge.description);
    await page.getByTestId('bill-save').click();

    await expect.poll(() => semanticsText(page.getByTestId(`bill-total-${data.tenant}`))).toContain(data.expectedTotal);
  });
});
