#!/usr/bin/env node
// One command: Jona bridge (:5001) + Go backend (:8080) + booth (:5173) + admin (:5174).
//   npm run start:jona            real arm on JONA_PORT (default auto: the STM32 USB port)
//   npm run start:jona -- --mock  fake arm, no hardware
//   npm run start:jona -- --lan   also open the admin to the local network (tablet on the same Wi-Fi);
//                                 login is still required. Booth and robot bridge stay on this PC only.
// Env: JONA_PORT, GO_DIR, SEQUENCE_SLOT_SEC, ADMIN_HOST (admin listen address; --lan = 0.0.0.0)
import { spawn, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { networkInterfaces } from 'node:os';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const mock = process.argv.includes('--mock');
const lan = process.argv.includes('--lan');
// The glambot backend this booth and admin are copied from (audio, voucher, free mode, timers).
const goDir = process.env.GO_DIR ?? 'C:\\Users\\WELCOME\\Dobot\\glambot-app\\backend';
const bridgeEnv = mock ? { JONA_MOCK: '1' } : { JONA_PORT: process.env.JONA_PORT ?? 'auto' };
const adminEnv = lan ? { ADMIN_HOST: '0.0.0.0' } : {};

const apps = [
  { name: 'jona', cwd: root, cmd: 'npm run jona-bridge', env: bridgeEnv },
  { name: 'go', cwd: goDir, cmd: 'go run .' },
  { name: 'booth', cwd: root, cmd: 'npm run dev:booth' },
  { name: 'admin', cwd: root, cmd: 'npm run dev:admin', env: adminEnv },
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
if (lan) {
  // Private LAN addresses only (skip VPN adapters such as Cloudflare WARP's 172.16.x).
  const ips = Object.entries(networkInterfaces())
    .filter(([name]) => !/warp|vpn|virtual|vethernet|loopback/i.test(name))
    .flatMap(([, list]) => list ?? [])
    .filter((a) => a.family === 'IPv4' && !a.internal && /^(192\.168|10)\./.test(a.address))
    .map((a) => `http://${a.address}:5174/admin/`);
  console.log(`Admin dari tablet (Wi-Fi yang sama): ${ips.join('  ') || '(alamat LAN tidak ditemukan)'}`);
}
