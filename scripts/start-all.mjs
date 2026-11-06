#!/usr/bin/env node
// One command: Jona bridge (:5001) + Go backend (:8080) + booth (:5173) + admin (:5174).
//   npm run start:jona            real arm on JONA_PORT (default auto: the STM32 USB port)
//   npm run start:jona -- --mock  fake arm, no hardware
// Env: JONA_PORT, GO_DIR, SEQUENCE_SLOT_SEC
import { spawn, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const mock = process.argv.includes('--mock');
// The glambot backend this booth and admin are copied from (audio, voucher, free mode, timers).
const goDir = process.env.GO_DIR ?? 'C:\\Users\\WELCOME\\Dobot\\glambot-app\\backend';
const bridgeEnv = mock ? { JONA_MOCK: '1' } : { JONA_PORT: process.env.JONA_PORT ?? 'auto' };

const apps = [
  { name: 'jona', cwd: root, cmd: 'npm run jona-bridge', env: bridgeEnv },
  { name: 'go', cwd: goDir, cmd: 'go run .' },
  { name: 'booth', cwd: root, cmd: 'npm run dev:booth' },
  { name: 'admin', cwd: root, cmd: 'npm run dev:admin' },
];

const procs = apps.map(({ name, cwd, cmd, env }) => {
  const p = spawn(cmd, { cwd, shell: true, env: { ...process.env, ...env } });
  const out = (s) => (d) => s.write(d.toString().replace(/^(?=.)/gm, `[${name}] `));
  p.stdout.on('data', out(process.stdout));
  p.stderr.on('data', out(process.stderr));
  p.on('exit', (code) => {
    console.error(`[${name}] exited (${code}) - stopping all`);
    stop(code ?? 1);
  });
  return p;
});

let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  // shell:true leaves grandchildren (go, vite, tsx) alive on Windows: kill the whole tree.
  for (const p of procs) {
    try {
      if (process.platform === 'win32') execSync(`taskkill /pid ${p.pid} /T /F`, { stdio: 'ignore' });
      else p.kill();
    } catch {
      /* already gone */
    }
  }
  process.exit(code);
}
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));

console.log(`Jona ${mock ? 'MOCK' : bridgeEnv.JONA_PORT} | Go ${goDir} | booth http://localhost:5173 | admin http://localhost:5174/admin/  (Ctrl+C stops all)`);
