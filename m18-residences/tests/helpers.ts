import { expect, type Locator, type Page } from '@playwright/test';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { ports } from '../env.mjs';

export const adminUrl = `http://localhost:${ports.admin}/`;
export const tenantUrl = (accountId: string) => `http://localhost:${ports.tenant}/${encodeURIComponent(accountId)}`;
/** The `#/NAME` form tenant links had before the app moved to path URLs; still prefills the account ID. */
export const legacyTenantUrl = (accountId: string) => `http://localhost:${ports.tenant}/#/${encodeURIComponent(accountId)}`;

/** Test data shared by the specs (tenant names are uppercase: the tenant login uppercases what it sends). */
export const data = {
  room: 'E2E ROOM 101',
  rent: 5000,
  tenant: 'E2E TENANT',
  prevReading: 100,
  currReading: 150, // 50 kWh at the default rate of 17 = 850
  charge: { amount: 200, description: 'Water' },
  expectedTotal: '6,050', // 5000 room + 850 electricity + 200 water
};

/**
 * Something on the page showing [text]. Flutter exposes a widget's text either as DOM text or as the
 * accessible name (aria-label) of its semantics node (e.g. a card becomes `group "E2E ROOM 101 Rent: ₱5000"`).
 */
export function showing(page: Page, text: string): Locator {
  const attr = text.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return page.getByText(text).or(page.locator(`[aria-label*="${attr}"]`)).first();
}

/** All text a semantics node shows: its DOM text plus its own and its descendants' aria-labels. */
export function semanticsText(scope: Locator): Promise<string> {
  return scope.evaluate((el) =>
    [el.textContent ?? '', ...[el, ...Array.from(el.querySelectorAll('[aria-label]'))].map((e) => e.getAttribute('aria-label') ?? '')].join(' '),
  );
}

/** The real <input> of a Flutter text field; the semantics identifier sits on its wrapper node. */
export function field(page: Page, testId: string): Locator {
  return page.getByTestId(testId).locator('input, textarea').first();
}

/**
 * Types into a Flutter text field the way a user does (click, then keystrokes) and checks the value landed.
 * Keystrokes sent right after the click can arrive before Flutter's editing session is ready and get lost (CI once
 * read "000" for "100"), so wait for focus, and redo the clear-and-type if the value still doesn't match.
 */
export async function typeInto(page: Page, testId: string, text: string | number): Promise<void> {
  const input = field(page, testId);
  const value = String(text);
  await expect(async () => {
    await input.click();
    await expect(input).toBeFocused({ timeout: 2_000 });
    // Flutter ignores DOM-level fill(''); clear any pre-filled value (e.g. a "0" reading) via real keystrokes.
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.press('Backspace');
    await input.pressSequentially(value);
    await expect(input).toHaveValue(value, { timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
}

/** Opens a Flutter dropdown by test id and picks the option with the given text. */
export async function pickOption(page: Page, testId: string, optionText: string): Promise<void> {
  await page.getByTestId(testId).click();
  const option = page
    .getByRole('menuitem', { name: optionText })
    .or(page.getByRole('option', { name: optionText }))
    .or(page.getByRole('button', { name: optionText }));
  await option.last().click();
}

/** Logs in to the tenant app through the tenant's link and waits for the latest bill's total. */
export async function loginAsTenant(page: Page): Promise<void> {
  await page.goto(tenantUrl(data.tenant));
  // Flutter web only mirrors a field's text into its accessibility <input> while the field is focused.
  const accountId = page.getByTestId('tenant-account-id').locator('input').first();
  await accountId.focus();
  await expect(accountId).toHaveValue(data.tenant);
  await page.getByTestId('tenant-login-submit').click();
  await expect.poll(() => semanticsText(page.getByTestId('tenant-latest-total'))).toContain(data.expectedTotal);
}

/**
 * The accessible name of a navigation destination: its label, after a badge count ("2 Verify") and before the
 * rail's position ("Rooms Tab 6 of 7").
 */
export function navName(label: string): RegExp {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^(\\d+ )?${escaped}( Tab \\d+ of \\d+)?$`);
}

/** A navigation destination: a tab of the bottom bar on phones, a rail destination (a button) on wider screens. */
export function navItem(page: Page, label: string): Locator {
  return page.getByRole('tab', { name: navName(label) }).or(page.getByRole('button', { name: navName(label) })).first();
}

/**
 * Opens a page of an app by its navigation label (the admin's Rooms, Electric Readings, ...; the tenant's Home,
 * History, Pay); [labels] are alternatives.
 *
 * Transitional (until both apps run the redesign in production): the deploy gate tests one new app with the other
 * as it is live, so this also drives the old apps, which open pages from a home page (Back first) and call the
 * tenant's Pay tab "Payment".
 */
export async function openPage(page: Page, ...labels: string[]): Promise<void> {
  const target = labels.map((l) => navItem(page, l)).reduce((a, b) => a.or(b)).first();
  const shown = () => target.waitFor({ state: 'visible', timeout: 2_000 }).then(() => true, () => false);
  if (!(await shown())) {
    const back = page.getByRole('button', { name: 'Back' });
    if (await back.isVisible()) await back.click();
  }
  await target.click();
}

/** The admin's start page: the dashboard, or (transitional, see [openPage]) the old home page. */
export function adminHome(page: Page): Locator {
  return showing(page, 'Needs attention').or(showing(page, 'Welcome Admin!')).first();
}

export async function loginAsAdmin(page: Page, username: string, password: string): Promise<void> {
  await page.goto(adminUrl);
  await typeInto(page, 'admin-username', username);
  await typeInto(page, 'admin-password', password);
  await page.getByTestId('admin-login-submit').click();
}

/**
 * A noisy RGB PNG of the given size (noise barely compresses, so it is big: a realistic phone-photo-sized upload
 * that the admin app must shrink and re-encode as WebP before sending).
 */
export function noisePng(width: number, height: number): Buffer {
  const raw = crypto.randomBytes((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) raw[y * (width * 3 + 1)] = 0; // each row's filter byte: none
  const chunk = (type: string, body: Buffer) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(body.length, 0);
    head.write(type, 4, 'ascii');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(Buffer.concat([Buffer.from(type, 'ascii'), body])), 0);
    return Buffer.concat([head, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
