// Shared settings for prepare.mjs and playwright.config.ts.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const workspace = path.resolve(here, '..', '..'); // the folder holding all the sibling repos (C:\dev locally)

/** Sibling repo checkouts; override with env vars when they live elsewhere (CI). */
export const repos = {
  server: process.env.M18_SERVER_DIR ?? path.join(workspace, 'm18-residences-server'),
  admin: process.env.M18_ADMIN_DIR ?? path.join(workspace, 'M18-Residences-Admin'),
  tenant: process.env.M18_TENANT_DIR ?? path.join(workspace, 'M18-Residences'),
};

/** Dedicated e2e ports, so a running dev setup (50000-50002) is never touched. */
export const ports = { api: 51000, admin: 51001, tenant: 51002 };

export const apiUrl = `http://localhost:${ports.api}/api`;

export const admin = {
  username: process.env.E2E_ADMIN_USERNAME ?? 'e2e-admin',
  password: process.env.E2E_ADMIN_PASSWORD ?? 'e2e-password',
};

export const jwtSecret = process.env.E2E_JWT_SECRET ?? 'e2e-jwt-secret-not-for-production';

export const serverExe = path.join(repos.server, 'target', 'e2e', 'debug', process.platform === 'win32' ? 'm18-residences-server.exe' : 'm18-residences-server');

/**
 * Database the e2e run wipes and re-migrates. E2E_DATABASE_URL, or the server's .env DATABASE_URL with the
 * database swapped to m18_e2e. Anything that does not end in /m18_e2e is refused, so a dev DB is never wiped.
 */
export function e2eDatabaseUrl() {
  let url = process.env.E2E_DATABASE_URL;
  if (!url) {
    const envFile = path.join(repos.server, '.env');
    const line = fs.existsSync(envFile) ? fs.readFileSync(envFile, 'utf8').split(/\r?\n/).find((l) => l.startsWith('DATABASE_URL=')) : undefined;
    if (!line) throw new Error(`Set E2E_DATABASE_URL, or add DATABASE_URL to ${envFile}`);
    const parsed = new URL(line.slice('DATABASE_URL='.length).trim().replace(/^"|"$/g, ''));
    parsed.pathname = '/m18_e2e';
    parsed.search = '';
    url = parsed.toString();
  }
  if (!new URL(url).pathname.endsWith('/m18_e2e')) {
    throw new Error(`Refusing to use ${new URL(url).pathname} for e2e: the database must be named m18_e2e (it is wiped on every run).`);
  }
  return url;
}

/** Environment for the API server under test. */
export function serverEnv() {
  return {
    PORT: String(ports.api),
    DATABASE_URL: e2eDatabaseUrl(),
    LOCALHOST_URL: `http://localhost:${ports.admin},http://localhost:${ports.tenant}`,
    PRODUCTION_URL: '',
    JWT_SECRET: jwtSecret,
    ADMIN_USERNAME: admin.username,
    ADMIN_PASSWORD: admin.password,
    // Dummy R2 settings: the server only needs them to start; the e2e flows never upload receipts.
    R2_ENDPOINT: 'https://example.invalid',
    R2_BUCKET_NAME: 'e2e',
    R2_ACCESS_KEY_ID: 'e2e',
    R2_SECRET_ACCESS_KEY: 'e2e',
  };
}
