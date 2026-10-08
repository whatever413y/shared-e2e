import { expect, test, type Locator, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { admin } from '../env.mjs';
import { adminUrl, field, loginAsAdmin, navItem, showing, tenantUrl, typeInto } from '../tests/helpers';

/**
 * Walks every screen of both apps on the dev-seed data and saves a PNG per screen, width and theme:
 * <SCREENSHOTS_OUT>/<app>-<screen>-<width>-<theme>.png. Screens an app version doesn't have are skipped, so the
 * same walk captures the UI before and after a redesign.
 *   SCREENSHOTS_OUT    output folder (default ./screenshots-out)
 *   SCREENSHOT_THEMES  comma list of light,dark (default both)
 *   SCREENSHOT_WIDTHS  comma list of phone,tablet,desktop,wide,ultrawide (default all)
 *   SCREENSHOT_TEXT_SCALE  e.g. 1.3: the browser's text size (Flutter web scales text with the root font size);
 *                          the files then end in -x1.3
 */
const out = path.resolve(process.env.SCREENSHOTS_OUT ?? 'screenshots-out');
const themes = (process.env.SCREENSHOT_THEMES ?? 'light,dark').split(',') as ('light' | 'dark')[];
const sizes = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'wide', width: 1920, height: 1080 },
  { name: 'ultrawide', width: 2560, height: 1440 },
].filter((s) => (process.env.SCREENSHOT_WIDTHS ?? 'phone,tablet,desktop,wide,ultrawide').split(',').includes(s.name));

const textScale = Number(process.env.SCREENSHOT_TEXT_SCALE ?? '1');

fs.mkdirSync(out, { recursive: true });

/** Applies [textScale] before the app starts. */
async function prepare(page: Page, theme: 'light' | 'dark', size: { width: number; height: number }) {
  await page.emulateMedia({ colorScheme: theme });
  await page.setViewportSize({ width: size.width, height: size.height });
  if (textScale !== 1) {
    await page.addInitScript((px) => {
      document.addEventListener('DOMContentLoaded', () => (document.documentElement.style.fontSize = px));
    }, `${16 * textScale}px`);
  }
}

/**
 * Flutter paints on a canvas: wait for the network to go quiet and animations to finish before a shot. The login
 * pages' Turnstile widget keeps its iframe talking to Cloudflare, so the network may never go quiet there: wait at
 * most 5 s for it.
 */
async function settle(page: Page) {
  await page.waitForLoadState('networkidle', { timeout: 5000 }).catch((e: unknown) => {
    if (!(e instanceof Error && e.name === 'TimeoutError')) throw e;
  });
  await page.waitForTimeout(900);
}

async function shot(page: Page, name: string) {
  await page.mouse.move(1, 1); // no hover tooltips in the picture
  await settle(page);
  await page.screenshot({ path: path.join(out, `${name}.png`) });
}

/**
 * The first match of any of the locators that becomes visible within a moment, or null when the screen has none of
 * them (Flutter may still be rebuilding its accessibility tree right after a tap, so an instant check misses things).
 */
async function firstVisible(...locators: Locator[]): Promise<Locator | null> {
  for (const l of locators) {
    const first = l.first();
    const shown = await first.waitFor({ state: 'visible', timeout: 1_500 }).then(
      () => true,
      () => false,
    );
    if (shown) return first;
  }
  return null;
}

/**
 * Opens an admin screen by its navigation label (or its shorter phone label), from a fresh load (the login is kept
 * in the browser): a destination of the rail or bottom bar, behind "More" on phones, or (before the redesign) a
 * button on the home page.
 */
async function openAdmin(page: Page, ...labels: string[]): Promise<boolean> {
  await page.goto(adminUrl);
  await settle(page);
  let target = await firstVisible(...labels.map((l) => navItem(page, l)));
  if (!target) {
    const more = await firstVisible(navItem(page, 'More'));
    if (!more) return false;
    await more.click();
    await settle(page);
    target = await firstVisible(...labels.map((l) => page.getByRole('button', { name: l, exact: true })));
  }
  if (!target) return false;
  await target.click();
  return true;
}

async function closeDialog(page: Page) {
  const close = await firstVisible(page.getByRole('button', { name: 'Close', exact: true }), page.getByRole('button', { name: 'Cancel' }));
  if (close) await close.click();
  else await page.keyboard.press('Escape');
}

async function loginTenant(page: Page, name: string) {
  await page.goto(tenantUrl(name));
  const accountId = page.getByTestId('tenant-account-id').locator('input').first();
  await accountId.focus();
  await expect(accountId).toHaveValue(name);
  await page.getByTestId('tenant-login-submit').click();
  await expect(page.getByTestId('tenant-latest-total')).toBeVisible();
}

async function logoutTenant(page: Page) {
  await page.getByRole('button', { name: 'Logout' }).first().click();
  await expect(page.getByTestId('tenant-login-submit')).toBeVisible();
}

for (const theme of themes) {
  for (const size of sizes) {
    const suffix = `${size.name}-${theme}${textScale === 1 ? '' : `-x${textScale}`}`;

    test(`admin ${suffix}`, async ({ page }) => {
      await prepare(page, theme, size);
      await page.goto(adminUrl);
      await expect(page.getByTestId('admin-login-submit')).toBeVisible();
      await shot(page, `admin-login-${suffix}`);
      await loginAsAdmin(page, admin.username, admin.password);
      await expect(page.getByTestId('admin-login-submit')).toHaveCount(0);
      await shot(page, `admin-home-${suffix}`);

      // The other theme, by the switch beside the brand (in the More sheet on phones); switched back after.
      const toggle = await firstVisible(page.getByTestId('theme-toggle'));
      if (toggle) {
        await toggle.click();
        await shot(page, `admin-home-switched-${suffix}`);
        await page.getByTestId('theme-toggle').click();
        await settle(page);
      }

      const search = await firstVisible(page.getByRole('button', { name: 'Search' }), page.getByPlaceholder(/Search/));
      if (search) {
        await search.click();
        await page.keyboard.type('a');
        await shot(page, `admin-search-${suffix}`);
        await page.keyboard.press('Escape');
      }

      if (await openAdmin(page, 'Verify')) await shot(page, `admin-verify-${suffix}`);

      if (await openAdmin(page, 'Billing')) {
        await expect(page.locator('[flt-semantics-identifier^="bill-total-"]').first()).toBeVisible();
        await shot(page, `admin-billing-${suffix}`);
        await page.locator('[flt-semantics-identifier^="bill-total-"]').first().click();
        await shot(page, `admin-bill-details-${suffix}`);
        await closeDialog(page);
        await settle(page);
        await page.locator('[flt-semantics-identifier^="bill-edit-"]').first().click();
        await shot(page, `admin-bill-form-${suffix}`);
        await closeDialog(page);
      }

      if (await openAdmin(page, 'Electric Readings', 'Readings')) await shot(page, `admin-readings-${suffix}`);
      if (await openAdmin(page, 'Tenants')) {
        await shot(page, `admin-tenants-${suffix}`);
        // The edit form and its date picker (Cancel leaves both unchanged).
        const edit = await firstVisible(page.getByRole('button', { name: 'Edit tenant' }));
        if (edit) {
          await edit.click();
          await shot(page, `admin-tenant-form-${suffix}`);
          await page.getByTestId('tenant-pick-date').click();
          await shot(page, `admin-date-picker-${suffix}`);
          await page.getByRole('button', { name: 'Cancel' }).last().click();
          await settle(page);
          await closeDialog(page);
        }
      }
      if (await openAdmin(page, 'Rooms')) {
        await shot(page, `admin-rooms-${suffix}`);
        await page.getByRole('button', { name: 'New Room' }).click();
        await shot(page, `admin-room-form-${suffix}`);
        await closeDialog(page);
        await settle(page);
        // A delete confirmation, cancelled.
        const remove = await firstVisible(page.getByRole('button', { name: 'Delete room' }));
        if (remove) {
          await remove.click();
          await shot(page, `admin-confirm-${suffix}`);
          await page.getByRole('button', { name: 'Cancel' }).click();
          await settle(page);
        }
        // The edit form unchanged (Save disabled), then a toast: the rent changed by one peso, then put back.
        const editRoom = await firstVisible(page.getByRole('button', { name: 'Edit room' }));
        if (editRoom) {
          await editRoom.click();
          await shot(page, `admin-room-edit-${suffix}`);
          // Flutter mirrors a field's value into its <input> only while it is focused.
          await field(page, 'room-rent').focus();
          const rent = Number(await field(page, 'room-rent').inputValue());
          await typeInto(page, 'room-rent', rent + 1);
          await page.getByTestId('room-save').click();
          await expect(showing(page, 'Room updated')).toBeVisible();
          await page.mouse.move(1, 1);
          await page.waitForTimeout(400);
          await page.screenshot({ path: path.join(out, `admin-toast-${suffix}.png`) });
          await page.getByRole('button', { name: 'Edit room' }).first().click();
          await typeInto(page, 'room-rent', rent);
          await page.getByTestId('room-save').click();
          await expect(page.getByTestId('room-save')).toHaveCount(0);
        }
      }
      if (await openAdmin(page, 'Payment QR Codes')) {
        await shot(page, `admin-qr-${suffix}`);
        const add = await firstVisible(page.getByRole('button', { name: 'New Payment Method' }));
        if (add) {
          await add.click();
          await shot(page, `admin-payment-method-form-${suffix}`);
          await closeDialog(page);
        }
      }
    });

    test(`tenant ${suffix}`, async ({ page }) => {
      await prepare(page, theme, size);
      await page.goto(tenantUrl('ECHO'));
      await expect(page.getByTestId('tenant-login-submit')).toBeVisible();
      await shot(page, `tenant-login-${suffix}`);

      // ECHO: unpaid; the full walk.
      await loginTenant(page, 'ECHO');
      await shot(page, `tenant-home-unpaid-${suffix}`);
      await page.getByTestId('tenant-latest-total').click();
      await expect(page.getByTestId('tenant-bill-status')).toBeVisible();
      await shot(page, `tenant-statement-${suffix}`);
      await page.getByRole('button', { name: 'Back' }).first().click();
      await expect(page.getByTestId('tenant-latest-total')).toBeVisible();

      const history = await firstVisible(navItem(page, 'History'), page.getByRole('button', { name: 'Billing History' }));
      if (history) {
        await history.click();
        await shot(page, `tenant-history-${suffix}`);
        const bill = await firstVisible(page.getByRole('button', { name: /^\w+ \d{4} .*kWh/ }));
        if (bill) {
          await bill.click();
          await shot(page, `tenant-bill-details-${suffix}`);
          await closeDialog(page);
          await settle(page);
        }
        const back = await firstVisible(page.getByRole('button', { name: 'Back' }));
        if (back) await back.click();
      }

      const pay = await firstVisible(navItem(page, 'Pay'), page.getByRole('button', { name: 'Payment', exact: true }));
      if (pay) {
        await pay.click();
        await expect(page.getByTestId('tenant-payment-gcash')).toBeVisible();
        await shot(page, `tenant-pay-${suffix}`);
        await page.getByTestId('tenant-payment-gcash').click();
        await shot(page, `tenant-qr-${suffix}`);
        await page.getByTestId('signed-file-close').click();
        const back = await firstVisible(page.getByRole('button', { name: 'Back' }));
        if (back) await back.click();
      }

      // ALPHA: a payment waiting for verification; CHARLIE: paid.
      for (const [name, status] of [
        ['ALPHA', 'verification'],
        ['CHARLIE', 'paid'],
      ]) {
        await logoutTenant(page);
        await loginTenant(page, name);
        await shot(page, `tenant-home-${status}-${suffix}`);
      }
    });
  }
}
