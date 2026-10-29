/**
 * Jona bridge: speaks the Dobot Flask service API (:5001) but drives the Jona arm.
 * Go backend (ROBOT_API_URL) and the booth (/dobot proxy) need no changes.
 *
 *   Go  → POST /robot/enable|disable|stop|preset     (this bridge)
 *   Booth → GET /detection                           (this bridge)
 *   this bridge → POST {BACKEND_URL}/api/robot/moving|done   (Go; Go runs 3-2-1 + shutter)
 *
 * Run: npm run jona-bridge   (env: JONA_PORT=COM5, or JONA_MOCK=1 for a dry run)
 */
import http from 'node:http';
import fs from 'node:fs';
import { JonaRobotController, MockRobotController, SerialTransport, type RobotAngle, type RobotController } from '../packages/robot/src/index';

const env = process.env;
const PORT = Number(env.BRIDGE_PORT ?? 5001);
const BACKEND = (env.BACKEND_URL ?? 'http://localhost:8080').replace(/\/$/, '');
const SLOT_SEC = Number(env.SEQUENCE_SLOT_SEC ?? 30);
const LEAD_SEC = Number(env.SEQUENCE_CAPTURE_LEAD_SEC ?? 3); // must equal presetCaptureDelay in Go
const START_DELAY = Number(env.SEQUENCE_START_DELAY_SEC ?? 1);
const POST_DELAY = Number(env.POST_ACTION_DELAY_SEC ?? 1);
const MOVE_TIMEOUT = Number(env.JONA_MOVE_TIMEOUT_MS ?? 30000);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const angles: RobotAngle[] = JSON.parse(fs.readFileSync(env.ROBOT_ANGLES_FILE ?? 'config/angles.json', 'utf8')).angles;
const robot: RobotController = env.JONA_MOCK
  ? new MockRobotController()
  : new JonaRobotController(new SerialTransport(env.JONA_PORT ?? 'COM5', 115200), { moveTimeoutMs: MOVE_TIMEOUT });
robot.setAngles(angles);

type Fsm = 'IDLE' | 'MOVING' | 'TRACKING' | 'CAPTURING' | 'DONE';
const st = { fsm: 'IDLE' as Fsm, active: false, enabled: false, busy: false, index: 0, total: angles.length, preset: null as number | null, slotStart: 0, slotLen: SLOT_SEC, complete: false };
let runId = 0;

async function notify(path: string, preset: number) {
  if (!st.active) return;
  await fetch(BACKEND + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ preset, status: path.endsWith('done') ? 'done' : 'moving' }), signal: AbortSignal.timeout(2000) }).catch((e) => console.warn(`[callback] ${path} failed: ${e.message}`));
}

/** Sleep that aborts when the run is cancelled. Returns true if cancelled. */
async function wait(ms: number, id: number) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (id !== runId) return true;
    await sleep(Math.min(100, end - Date.now()));
  }
  return id !== runId;
}

async function runSequence(id: number, order: number[]) {
  st.complete = false;
  st.total = order.length;
  if (await wait(START_DELAY * 1000, id)) return;
  for (const [i, preset] of order.entries()) {
    if (id !== runId) return;
    st.fsm = 'MOVING';
    st.index = i + 1;
    st.preset = preset;
    st.slotStart = Date.now();
    st.slotLen = Math.max(LEAD_SEC + 1, SLOT_SEC);
    console.log(`[sequence] pose ${i + 1}/${order.length} → preset ${preset}`);
    await notify('/api/robot/moving', preset);
    try {
      await robot.moveToAngle(preset);
    } catch (e) {
      console.warn(`[sequence] move to ${preset} failed: ${(e as Error).message}`);
    }
    if (id !== runId) return;
    st.fsm = 'TRACKING'; // arm holds still while Go prepares; no face tracking on Jona
    if (await wait(Math.max(0, st.slotLen - LEAD_SEC) * 1000 - (Date.now() - st.slotStart), id)) return;
    st.fsm = 'CAPTURING';
    await notify('/api/robot/done', preset); // Go starts 3-2-1 and fires the shutter
    if (await wait((LEAD_SEC + POST_DELAY) * 1000, id)) return;
  }
  st.fsm = 'DONE';
  st.preset = null;
  st.complete = true;
  console.log('[sequence] done');
}

async function enable(only?: number[]) {
  st.busy = true;
  try {
    await robot.connect();
    await robot.home();
    st.enabled = true;
    st.active = true;
    const id = ++runId;
    const order = only?.length ? only : angles.map((a) => a.id);
    void runSequence(id, order);
  } catch (e) {
    console.error(`[enable] failed: ${(e as Error).message}`);
    st.active = st.enabled = false;
  } finally {
    st.busy = false;
  }
}

async function disable() {
  runId++; // cancels the running sequence
  st.active = false;
  st.fsm = 'IDLE';
  st.busy = true;
  try {
    await robot.stop();
    await sleep(300);
    await robot.home();
  } catch (e) {
    console.error(`[disable] home failed: ${(e as Error).message}`);
  } finally {
    st.enabled = false;
    st.busy = false;
  }
}

const progress = () => {
  const left = st.fsm === 'IDLE' || st.fsm === 'DONE' ? 0 : Math.max(0, st.slotLen - (Date.now() - st.slotStart) / 1000);
  return { index: st.index, total: st.total, preset: st.preset, preset_name: angles.find((a) => a.id === st.preset)?.name ?? null, seconds_left: Math.round(left * 10) / 10, slot_sec: st.slotLen, percent: Math.round(100 * (1 - left / st.slotLen)), complete: st.complete };
};

const body = (req: http.IncomingMessage) =>
  new Promise<any>((res) => {
    let s = '';
    req.on('data', (c) => (s += c));
    req.on('end', () => { try { res(JSON.parse(s || '{}')); } catch { res({}); } });
  });

http
  .createServer(async (req, res) => {
    const send = (code: number, o: unknown) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    const url = (req.url ?? '').split('?')[0];
    const key = `${req.method} ${url}`;
    try {
      switch (key) {
        case 'GET /health': return send(200, { status: 'ok', service: 'jona-bridge' });
        case 'GET /detection':
          return send(200, { session_active: st.active, face_detected: false, face_offset: null, tracking_active: false, fsm_state: st.fsm, status: st.fsm, sequence: progress(), robot: { connected: (await robot.getStatus().catch(() => null))?.connected ?? false, enabled: st.enabled, current_preset: st.preset } });
        case 'GET /status': return send(200, { running: true, session_active: st.active, fsm_state: st.fsm, capture_locked: st.fsm !== 'IDLE' && st.fsm !== 'DONE', robot: { connected: true, enabled: st.enabled, dry_run: !!env.JONA_MOCK } });
        case 'GET /sequence': return send(200, { fsm_state: st.fsm, ...progress() });
        case 'GET /presence': return send(200, { present: false, motion_ratio: 0 });
        case 'GET /config/runtime':
        case 'POST /config/runtime': return send(200, { status: 'applied', settings: {} });
        case 'POST /robot/enable': {
          if (st.busy) return send(409, { error: 'busy — robot masih homing' });
          if (st.enabled) return send(200, { status: 'already_enabled' });
          const only = ((await body(req)).only as unknown[] | undefined)?.map(Number).filter((n) => angles.some((a) => a.id === n));
          void enable(only);
          return send(200, { status: 'enabling', message: 'Jona homing, lalu sequence pose dimulai' });
        }
        case 'POST /robot/disable':
          if (st.busy) return send(409, { error: 'busy' });
          if (!st.enabled) return send(200, { status: 'already_disabled' });
          void disable();
          return send(200, { status: 'disabling' });
        case 'POST /robot/stop':
          runId++;
          st.active = st.enabled = false;
          st.fsm = 'IDLE';
          await robot.stop();
          return send(200, { status: 'stopped' });
        case 'POST /robot/preset': {
          const n = Number((await body(req)).preset);
          if (!angles.some((a) => a.id === n)) return send(404, { error: `preset ${n} not defined` });
          if (st.busy || st.fsm === 'MOVING' || st.fsm === 'CAPTURING') return send(409, { error: 'busy — robot sedang bergerak' });
          st.busy = true;
          void robot.moveToAngle(n).catch((e) => console.warn(e.message)).finally(() => (st.busy = false));
          return send(200, { status: 'moving', preset: n });
        }
        case 'POST /sequence/skip': st.slotStart = 0; return send(200, { status: 'skipped', ...progress() });
        default: return send(404, { error: 'not found' });
      }
    } catch (e) {
      send(500, { error: (e as Error).message });
    }
  })
  .listen(PORT, () => console.log(`jona-bridge on :${PORT} (${env.JONA_MOCK ? 'MOCK' : (env.JONA_PORT ?? 'COM5')}) → Go ${BACKEND}`));
