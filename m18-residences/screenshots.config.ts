import { defineConfig } from '@playwright/test';
import base from './playwright.config';

/**
 * Screenshots of every screen (npm run screenshots): the e2e web servers and builds, the dev-seed's synthetic data
 * (screenshots/seed.mjs), and screenshots/capture.spec.ts instead of the e2e specs.
 */
export default defineConfig({
  ...base,
  testDir: './screenshots',
  timeout: 600_000,
  reporter: 'list',
  use: { ...base.use, trace: 'off', screenshot: 'off' },
});
