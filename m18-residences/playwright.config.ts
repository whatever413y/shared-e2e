import { defineConfig } from '@playwright/test';
import path from 'node:path';
import { ports, repos, serverConfig, serverVarsFile, statePath, wrangler } from './env.mjs';

/**
 * Serves a Flutter release build the way production does: `wrangler dev` with the app's own wrangler.jsonc
 * (static assets, every unknown path answered with index.html, so tenant links like /NAME work).
 */
const staticSite = (dir: string, port: number) => ({
  command: `node "${wrangler}" dev --config "${path.join(dir, 'wrangler.jsonc')}" --port ${port} --ip 127.0.0.1 --inspector-port ${port + 9} --persist-to "${path.join(statePath, `site-${port}`)}" --show-interactive-dev-session=false`,
  cwd: dir,
  url: `http://127.0.0.1:${port}`, // readiness probe over IPv4 (localhost may resolve to ::1 first); tests browse via localhost
  reuseExistingServer: false,
  timeout: 120_000,
});

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1, // the specs share one database and build on each other's data
  retries: 0, // the specs build on each other's data; a retry would collide with its own first attempt (unique room/tenant names)
  timeout: 120_000,
  expect: { timeout: 20_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    channel: 'chrome', // the installed Google Chrome (also preinstalled on GitHub's ubuntu runners)
    viewport: { width: 1600, height: 1000 }, // the admin billing table is wide
    testIdAttribute: 'flt-semantics-identifier', // Flutter renders Semantics(identifier:) as this attribute
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      // The API Worker in the real Workers runtime (workerd), with the run's local D1 + R2 and e2e config.
      command: `node "${wrangler}" dev --config "${serverConfig}" --port ${ports.api} --ip 127.0.0.1 --persist-to "${statePath}" --env-file "${serverVarsFile}" --inspector-port ${ports.api + 9} --show-interactive-dev-session=false`,
      cwd: repos.server,
      url: `http://127.0.0.1:${ports.api}/health`,
      reuseExistingServer: false,
      timeout: 300_000, // starts with `worker-build` (incremental after prepare.mjs)
    },
    staticSite(repos.admin, ports.admin),
    staticSite(repos.tenant, ports.tenant),
  ],
});
