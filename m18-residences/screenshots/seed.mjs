// Fills the run's fresh local D1 + R2 (.wrangler-e2e, created by prepare.mjs) with the server's dev-seed data:
// six tenants ALPHA … FOXTROT, a year of bills, and latest bills in every status.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { repos, statePath, wrangler } from '../env.mjs';

const seed = path.join(repos.server, 'tools', 'dev-seed', 'seed.mjs');
const result = spawnSync('node', [seed, '--local', '--persist-to', statePath], {
  stdio: 'inherit',
  env: { ...process.env, WRANGLER_JS: wrangler },
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
