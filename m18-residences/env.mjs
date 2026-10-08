// Shared settings for prepare.mjs and playwright.config.ts.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const workspace = path.resolve(here, '..', '..'); // the folder holding all the sibling repos (C:\dev locally)

/** Sibling repo checkouts; override with env vars when they live elsewhere (CI). */
export const repos = {
  server: process.env.M18_RESIDENCES_SERVER_DIR ?? path.join(workspace, 'm18-residences-server'),
  admin: process.env.M18_RESIDENCES_ADMIN_DIR ?? path.join(workspace, 'm18-residences-admin'),
  tenant: process.env.M18_RESIDENCES_TENANT_DIR ?? path.join(workspace, 'm18-residences-tenant'),
};

/** Dedicated e2e ports, so a running dev setup (50000-50002) is never touched. */
export const ports = { api: 51000, admin: 51001, tenant: 51002 };

export const apiUrl = `http://localhost:${ports.api}/api`;

export const admin = {
  username: process.env.E2E_ADMIN_USERNAME ?? 'e2e-admin',
  password: process.env.E2E_ADMIN_PASSWORD ?? 'e2e-password',
};

export const jwtSecret = process.env.E2E_JWT_SECRET ?? 'e2e-jwt-secret-not-for-production';

/**
 * Cloudflare Turnstile's always-pass test keys (public, documented by Cloudflare): the apps render the widget with the
 * site key and the API accepts any token with the secret. The widget's script loads from challenges.cloudflare.com, so
 * runs need internet access.
 */
export const turnstile = {
  siteKey: '1x00000000000000000000AA',
  secret: '1x0000000000000000000000000000000AA',
};

/** Local D1 + R2 state for the run; wiped by prepare.mjs, so nothing from dev (`.wrangler/state`) is touched. */
export const statePath = path.join(here, '.wrangler-e2e');

/** The API's configuration for the run (written to an env file for `wrangler dev --env-file`). */
export const serverVarsFile = path.join(statePath, 'e2e.vars');

export function serverVars() {
  return {
    JWT_SECRET: jwtSecret,
    ADMIN_USERNAME: admin.username,
    ADMIN_PASSWORD: admin.password,
    ALLOWED_ORIGINS: `http://localhost:${ports.admin},http://localhost:${ports.tenant}`,
    TURNSTILE_SECRET: turnstile.secret,
  };
}

/** The wrangler this suite pins (package.json), run with node so no .cmd shim is involved on Windows. */
export const wrangler = path.join(here, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
export const serverConfig = path.join(repos.server, 'wrangler.jsonc');
