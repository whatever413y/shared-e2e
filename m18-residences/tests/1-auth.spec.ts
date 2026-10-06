import { expect, test } from '@playwright/test';
import { admin } from '../env.mjs';
import { adminHome, loginAsAdmin, showing } from './helpers';

test('admin login rejects a wrong password and stays on the login page', async ({ page }) => {
  await loginAsAdmin(page, admin.username, 'definitely-wrong');

  // Shown under the field (Flutter also announces it to screen readers, hence the scoped locator).
  await expect(page.getByTestId('admin-password').getByText('Invalid credentials')).toBeVisible();
  await expect(showing(page, 'Admin Login')).toBeVisible();
});

test('admin login with the right password reaches the dashboard', async ({ page }) => {
  await loginAsAdmin(page, admin.username, admin.password);

  await expect(adminHome(page)).toBeVisible();
});
