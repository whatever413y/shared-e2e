// Runs before `playwright test` (Playwright starts its web servers before any globalSetup, so the
// builds must already exist): fresh e2e schema, server build, and release web builds of both apps.
import { spawnSync } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { apiUrl, e2eDatabaseUrl, ports, repos } from './env.mjs';

const isWindows = process.platform === 'win32';

function run(title, command, args, cwd, env = {}) {
  console.log(`\n▶ ${title}\n  (${cwd}) ${command} ${args.join(' ')}`);
  // flutter is a .bat on Windows, which needs a shell; cargo is a plain executable.
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', shell: isWindows && command === 'flutter', env: { ...process.env, ...env } });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    console.error(`\n✖ ${title} failed (exit ${result.status})`);
    process.exit(result.status ?? 1);
  }
}

function assertPortFree(port) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ port, host: '127.0.0.1' });
    socket.once('connect', () => {
      socket.destroy();
      reject(new Error(`Port ${port} is already in use; stop whatever is listening there before running e2e.`));
    });
    socket.once('error', () => resolve());
  });
}

for (const port of Object.values(ports)) await assertPortFree(port);

// DATABASE_URL is passed through the environment (never the dev .env): the migration CLI only falls back
// to ../.env when the variable is unset, and e2eDatabaseUrl() refuses anything but .../m18_e2e.
const databaseUrl = e2eDatabaseUrl();
run('Reset the m18_e2e schema', 'cargo', ['run', '--quiet', '--', 'fresh'], path.join(repos.server, 'migration'), { DATABASE_URL: databaseUrl });

// `--db-only` (npm run test:fresh): fresh data for re-running the specs against the last builds.
if (process.argv.includes('--db-only')) {
  console.log('\n✔ database reset (builds reused)');
  process.exit(0);
}

// Separate target dir: a running dev server keeps target/debug's exe locked on Windows.
run('Build the API server', 'cargo', ['build', '--target-dir', path.join('target', 'e2e')], repos.server);

for (const [name, dir] of [['admin', repos.admin], ['tenant', repos.tenant]]) {
  run(`Build the ${name} app (release, e2e semantics on)`, 'flutter', [
    'build',
    'web',
    '--release',
    '--no-web-resources-cdn',
    `--dart-define=API_URL=${apiUrl}`,
    '--dart-define=E2E=true',
  ], dir);
}

console.log('\n✔ e2e environment prepared');
