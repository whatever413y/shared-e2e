// Runs before `playwright test` (Playwright starts its web servers before any globalSetup, so the
// builds must already exist): fresh local D1/R2 state, the API Worker build, and release web builds of both apps.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import { apiUrl, ports, repos, serverConfig, serverVars, serverVarsFile, statePath, wrangler } from './env.mjs';

const isWindows = process.platform === 'win32';

function run(title, command, args, cwd) {
  console.log(`\n▶ ${title}\n  (${cwd}) ${command} ${args.join(' ')}`);
  // flutter is a .bat on Windows, which needs a shell; node and worker-build are plain executables.
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', shell: isWindows && command === 'flutter' });
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

// A throwaway local D1 + R2 (wrangler's --persist-to), never the dev state in the server's .wrangler/.
fs.rmSync(statePath, { recursive: true, force: true });
fs.mkdirSync(statePath, { recursive: true });
const vars = Object.entries(serverVars()).map(([key, value]) => `${key}="${value}"`);
fs.writeFileSync(serverVarsFile, `${vars.join('\n')}\n`);
run('Create the e2e database (D1 migrations)', 'node', [wrangler, 'd1', 'migrations', 'apply', 'm18-residences', '--local', '--config', serverConfig, '--persist-to', statePath], repos.server);

// `--db-only` (npm run test:fresh): fresh data for re-running the specs against the last builds.
if (process.argv.includes('--db-only')) {
  console.log('\n✔ database reset (builds reused)');
  process.exit(0);
}

// wrangler dev runs the same build again on start; doing it here first fails fast with the compiler output.
run('Build the API Worker', 'worker-build', ['--release'], repos.server);

for (const [name, dir] of [
  ['admin', repos.admin],
  ['tenant', repos.tenant],
]) {
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
