/**
 * Jona bridge: speaks the Dobot Flask service API (:5001) but drives the Jona arm.
 * Go backend (ROBOT_API_URL) and the booth (/dobot proxy) need no changes.
 *
 *   Go  → POST /robot/enable|disable|stop|preset, POST /config/runtime   (this bridge)
 *   Booth → GET /detection                                               (this bridge)
 *   this bridge → POST {BACKEND_URL}/api/robot/moving|done   (Go; Go runs 3-2-1 + shutter)
 *   Admin page (/jona proxy) → /admin/*  jog joint by joint, edit poses (admin token checked with Go)
 *
 * Run: npm run jona-bridge   (env: JONA_PORT=COM5, or JONA_MOCK=1 for a dry run)
 */
import http from 'node:http';
import fs from 'node:fs';
import {
  checkJonaPose,
  JONA_JOINTS,
  jonaDegPerSec,
  JonaRobotController,
  MockJonaController,
  SerialTransport,
  type ManualArm,
  type RobotAngle,
  type RobotController,
} from '../packages/robot/src/index';

const env = process.env;
const PORT = Number(env.BRIDGE_PORT ?? 5001);
const BACKEND = (env.BACKEND_URL ?? 'http://localhost:8080').replace(/\/$/, '');
const LEAD_SEC = Number(env.SEQUENCE_CAPTURE_LEAD_SEC ?? 3); // must equal presetCaptureDelay in Go
const START_DELAY = Number(env.SEQUENCE_START_DELAY_SEC ?? 1);
const MOVE_TIMEOUT = Number(env.JONA_MOVE_TIMEOUT_MS ?? 30000);
const ANGLES_FILE = env.ROBOT_ANGLES_FILE ?? 'config/angles.json';
/** 'auto' = first STM32 USB serial port (COM numbers change with the USB socket); or e.g. JONA_PORT=COM3. */
const SERIAL = env.JONA_PORT ?? 'auto';
const JOG_WATCHDOG_MS = 500; // the admin page beats every 150 ms while a jog button is held
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Admin → Pengaturan → Robot (Go keeps them; pushed here via /config/runtime and read at start). */
const tuning = { slotSec: Number(env.SEQUENCE_SLOT_SEC ?? 30), postDelay: Number(env.POST_ACTION_DELAY_SEC ?? 1) };
function applyTuning(o: Record<string, unknown>) {
  const num = (v: unknown, lo: number, hi: number) => (typeof v === 'number' && v >= lo && v <= hi ? v : null);
  const slot = num(o.sequenceSlotSec, 5, 120);
  const post = num(o.postActionDelay, 0, 5);
  if (slot !== null) tuning.slotSec = slot;
  if (post !== null) tuning.postDelay = post;
  return { sequenceSlotSec: tuning.slotSec, postActionDelay: tuning.postDelay };
}

// ------------------------------------------------------------------ poses file (config/angles.json)

let angles: RobotAngle[] = JSON.parse(fs.readFileSync(ANGLES_FILE, 'utf8')).angles;

/** One-line JSON in the file's hand-written style: { "id": 1, "joints": [0, -58] }. */
const inline = (v: unknown): string =>
  Array.isArray(v)
    ? `[${v.map(inline).join(', ')}]`
    : v && typeof v === 'object'
      ? `{ ${Object.entries(v).map(([k, x]) => `${JSON.stringify(k)}: ${inline(x)}`).join(', ')} }`
      : JSON.stringify(v);

/** Rewrite the file (keeps $comment and any other field), one pose per line, atomically. */
function saveAngles(next: RobotAngle[]) {
  const doc = JSON.parse(fs.readFileSync(ANGLES_FILE, 'utf8'));
  const head = Object.entries(doc)
    .filter(([k]) => k !== 'angles')
    .map(([k, v]) => `  ${JSON.stringify(k)}: ${inline(v)},\n`)
    .join('');
  const text = `{\n${head}  "angles": [\n${next.map((a) => '    ' + inline(a)).join(',\n')}\n  ]\n}\n`;
  fs.writeFileSync(ANGLES_FILE + '.tmp', text);
  fs.renameSync(ANGLES_FILE + '.tmp', ANGLES_FILE);
  angles = next;
  robot.setAngles(angles);
}

/** Ids are the visiting order (booth: angle N = preset PN), so renumber 1..N; default names follow. */
const renumber = (list: RobotAngle[]) => list.map((a, i) => ({ ...a, id: i + 1, name: /^P\d+$/.test(a.name) ? `P${i + 1}` : a.name }));
const round2 = (degs: number[]) => degs.map((v) => Math.round(v * 100) / 100);

// ------------------------------------------------------------------ robot

const serial = new SerialTransport(SERIAL, 115200);
const robot: RobotController & ManualArm = env.JONA_MOCK
  ? new MockJonaController()
  : new JonaRobotController(serial, { moveTimeoutMs: MOVE_TIMEOUT });
robot.setAngles(angles);

type Fsm = 'IDLE' | 'MOVING' | 'TRACKING' | 'CAPTURING' | 'DONE';
/** Same modes as the Dobot service (dobot/app/core/runtime.py), so the Go backend's safety checks work unchanged. */
type Mode = 'standby' | 'enabling' | 'active' | 'disabling' | 'stopping';
const st = {
  fsm: 'IDLE' as Fsm,
  mode: 'standby' as Mode,
  error: null as string | null,
  active: false, // a booth session is running the sequence
  sessionStopped: false, // the session ended early (stop, failed move, failed enable): booth goes to Review
  busy: false, // admin manual control or a Go /robot/preset move
  index: 0,
  total: angles.length,
  preset: null as number | null,
  slotStart: 0,
  slotLen: tuning.slotSec,
  complete: false,
};
let runId = 0; // bump = cancel the running sequence
let modeGen = 0; // bump = an emergency stop took over; workers still in flight must not touch the mode
let cancelEnable = false;
let sequence: Promise<void> = Promise.resolve();
/** Admin manual control. While set, st.busy is true so a booth session cannot start. */
const manual = { what: null as string | null, lastBeat: 0, error: null as string | null };
const msg = (e: unknown) => (e as Error).message;

async function notify(path: string, preset: number) {
  if (!st.active) return;
  await fetch(BACKEND + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ preset, status: path.endsWith('done') ? 'done' : 'moving' }), signal: AbortSignal.timeout(2000) }).catch((e) => console.warn(`[callback] ${path} failed: ${e.message}`));
}

/** Set by POST /sequence/skip: the booth's pose narration ended, so start the shot now. */
let prepSkip = false;

/** Sleep that aborts when the run is cancelled (returns true) or ends early once `until` holds. */
async function wait(ms: number, id: number, until?: () => boolean) {
  const end = Date.now() + ms;
  while (Date.now() < end && !until?.()) {
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
    st.slotLen = Math.max(LEAD_SEC + 1, tuning.slotSec);
    console.log(`[sequence] pose ${i + 1}/${order.length} → preset ${preset}`);
    await notify('/api/robot/moving', preset);
    try {
      await robot.moveToAngle(preset);
    } catch (e) {
      if (id !== runId) return; // stopped or disabled on purpose
      // The arm is not where the photo expects it: no shot, end the session (booth shows Review).
      return abortMotion(`Gagal ke pose ${preset}: ${msg(e)}`);
    }
    if (id !== runId) return;
    // Arm holds still while the booth narrates the pose (no face tracking on Jona). The booth calls
    // /sequence/skip when the narration ends; "Durasi per pose" is only the cap, as on the Dobot.
    prepSkip = false;
    st.fsm = 'TRACKING';
    if (await wait(Math.max(0, st.slotLen - LEAD_SEC) * 1000 - (Date.now() - st.slotStart), id, () => prepSkip)) return;
    st.fsm = 'CAPTURING';
    await notify('/api/robot/done', preset); // Go starts 3-2-1 and fires the shutter
    if (await wait((LEAD_SEC + tuning.postDelay) * 1000, id)) return;
  }
  st.fsm = 'DONE';
  st.preset = null;
  st.complete = true;
  console.log('[sequence] done');
}

/** A move failed mid-session: halt where it is, end the session, report the reason. */
async function abortMotion(reason: string) {
  runId++;
  modeGen++;
  st.active = false;
  st.sessionStopped = true;
  st.mode = 'stopping';
  st.fsm = 'IDLE';
  await robot.stop().catch(() => undefined);
  st.mode = 'standby';
  st.error = reason;
  console.error(`[robot] ${reason}`);
}

function requestEnable(only?: number[]): [number, object] {
  if (st.busy) return [409, { error: manual.what ? `busy — admin: robot sedang ${manual.what}` : 'busy — robot sedang bergerak' }];
  if (st.mode === 'enabling') return [200, { status: 'enabling', message: 'Robot sedang diaktifkan' }];
  if (st.mode === 'disabling' || st.mode === 'stopping') return [409, { error: 'robot sedang dimatikan, coba lagi' }];
  if (st.mode === 'active') return [200, { status: 'already_enabled' }];
  st.mode = 'enabling';
  st.error = null;
  st.sessionStopped = false;
  cancelEnable = false;
  const gen = ++modeGen;
  void (async () => {
    try {
      await robot.connect();
      await robot.home();
    } catch (e) {
      if (gen !== modeGen) return; // an emergency stop took over
      st.sessionStopped = true;
      st.mode = 'standby';
      st.error = `Robot gagal diaktifkan: ${msg(e)}`;
      console.error(`[enable] ${st.error}`);
      return;
    }
    if (gen !== modeGen) return;
    if (cancelEnable) {
      st.mode = 'standby'; // disable came while homing: home is where disable leaves the arm anyway
      return;
    }
    st.mode = 'active';
    st.active = true;
    const id = ++runId;
    sequence = runSequence(id, only?.length ? only : angles.map((a) => a.id));
  })();
  return [200, { status: 'enabling', message: 'Jona homing, lalu sequence pose dimulai' }];
}

function requestDisable(): [number, object] {
  st.sessionStopped = false;
  if (st.mode === 'enabling') {
    cancelEnable = true;
    st.active = false;
    return [200, { status: 'disabling', message: 'Enable dibatalkan, robot pulang ke home' }];
  }
  if (st.mode === 'disabling' || st.mode === 'stopping') return [200, { status: 'disabling', message: 'Robot sedang dimatikan' }];
  if (st.mode === 'standby') {
    st.error = null;
    st.active = false;
    return [200, { status: 'already_disabled' }];
  }
  st.mode = 'disabling';
  st.active = false;
  runId++; // the sequence ends after the move it is in (no abrupt stop mid-move)
  const gen = modeGen;
  void (async () => {
    try {
      await sequence;
      if (gen !== modeGen) return;
      await robot.home();
      if (gen !== modeGen) return;
      st.mode = 'standby';
      st.fsm = 'IDLE';
    } catch (e) {
      if (gen !== modeGen) return;
      st.mode = 'standby';
      st.error = `Robot gagal pulang ke home: ${msg(e)}`;
      console.error(`[disable] ${st.error}`);
    }
  })();
  return [200, { status: 'disabling', message: 'Robot kembali ke home' }];
}

/** Emergency stop: every motor halts where it is, any session or admin move ends. */
async function requestStop(): Promise<[number, object]> {
  if (st.mode === 'enabling' || st.mode === 'active') st.sessionStopped = true;
  runId++;
  modeGen++;
  cancelEnable = true;
  st.active = false;
  st.mode = 'stopping';
  manual.what = null;
  st.busy = false;
  try {
    await robot.stop();
  } catch (e) {
    st.mode = 'standby';
    st.error = `Emergency stop gagal: ${msg(e)}`;
    return [502, { error: st.error, disabled: false }];
  }
  st.mode = 'standby';
  st.fsm = 'IDLE';
  return [200, { status: 'stopped', disabled: true }];
}

const modeStatus = () => ({ mode: st.mode, standby: st.mode === 'standby' && !st.error, error: st.error });
const progress = () => {
  const left = st.fsm === 'IDLE' || st.fsm === 'DONE' ? 0 : Math.max(0, st.slotLen - (Date.now() - st.slotStart) / 1000);
  return { index: st.index, total: st.total, preset: st.preset, preset_name: angles.find((a) => a.id === st.preset)?.name ?? null, seconds_left: Math.round(left * 10) / 10, slot_sec: st.slotLen, percent: Math.round(100 * (1 - left / st.slotLen)), complete: st.complete };
};

// ------------------------------------------------------------------ admin manual control

class HttpErr extends Error {
  constructor(readonly code: number, message: string) {
    super(message);
  }
}

/** A booth session owns the arm from enable until it is back in standby (also a Go /robot/preset move). */
const sessionOwnsArm = () => st.mode !== 'standby' || st.active || (st.busy && manual.what === null);
function lockedBySession() {
  if (sessionOwnsArm()) throw new HttpErr(409, 'Sesi foto sedang berjalan. Tunggu sampai selesai.');
}

/** Manual control only while no booth session owns the arm. */
function claim(what: string) {
  lockedBySession();
  if (st.busy) throw new HttpErr(409, manual.what ? `Robot sedang ${manual.what}.` : 'Robot sedang sibuk.');
  st.busy = true;
  manual.what = what;
  manual.error = null;
}
function release() {
  st.busy = false;
  manual.what = null;
}

/** Run a move in the background; the page follows it through /admin/state. */
function background(what: string, fn: () => Promise<unknown>) {
  claim(what);
  void (async () => {
    try {
      await robot.connect();
      await fn();
    } catch (e) {
      manual.error = (e as Error).message;
      console.warn(`[admin] ${what} failed: ${manual.error}`);
    } finally {
      release();
    }
  })();
}

async function jogStop() {
  if (manual.what !== 'jog') return;
  try {
    await robot.jogStop();
  } finally {
    release();
  }
}
setInterval(() => {
  if (manual.what === 'jog' && Date.now() - manual.lastBeat > JOG_WATCHDOG_MS) {
    console.warn('[admin] jog heartbeat lost, stopping');
    void jogStop();
  }
}, 100);

/** Admin token = Go's admin login. Valid tokens are remembered for a minute. */
const tokens = new Map<string, number>();
async function requireAdmin(req: http.IncomingMessage) {
  const auth = req.headers.authorization ?? '';
  if (!auth.startsWith('Bearer ')) throw new HttpErr(401, 'Token tidak ditemukan');
  if ((tokens.get(auth) ?? 0) > Date.now()) return;
  let ok = false;
  try {
    ok = (await fetch(`${BACKEND}/api/admin/robot-settings`, { headers: { authorization: auth }, signal: AbortSignal.timeout(3000) })).ok;
  } catch {
    throw new HttpErr(503, 'Backend tidak bisa dihubungi untuk cek login');
  }
  if (!ok) throw new HttpErr(401, 'Sesi tidak valid atau kedaluwarsa');
  tokens.set(auth, Date.now() + 60_000);
}

/** Pose the arm is holding now. Refused while it moves: the numbers would not be final. */
async function currentPose() {
  if (st.busy) throw new HttpErr(409, 'Tunggu robot berhenti dulu.');
  await robot.connect();
  return round2((await robot.readJoints()).deg);
}

function poseFrom(v: unknown) {
  try {
    return round2(checkJonaPose(v));
  } catch (e) {
    throw new HttpErr(400, (e as Error).message);
  }
}
function presetIndex(id: number) {
  const i = angles.findIndex((a) => a.id === id);
  if (i < 0) throw new HttpErr(404, `Pose ${id} tidak ada`);
  return i;
}
function cleanName(v: unknown, fallback: string) {
  const s = typeof v === 'string' ? v.trim() : '';
  if (s.length > 40) throw new HttpErr(400, 'Nama maksimal 40 karakter');
  return s || fallback;
}

async function adminState() {
  let connected = false;
  let joints = null;
  let error = manual.error;
  try {
    const status = await robot.getStatus();
    connected = status.connected;
    if (connected) joints = await robot.readJoints();
    else error ??= status.lastError ?? null; // tell the operator why (port busy, no answer, ...)
  } catch (e) {
    error = (e as Error).message;
  }
  return {
    port: env.JONA_MOCK ? 'simulasi' : serial.current === 'auto' ? 'otomatis (mencari STM32)' : serial.current,
    mock: !!env.JONA_MOCK,
    connected,
    session: sessionOwnsArm(),
    busy: st.busy,
    action: manual.what,
    error,
    joints,
    spec: JONA_JOINTS.map((j, i) => ({ joint: i, min: j.limitDeg[0], max: j.limitDeg[1], degPerSec: Math.round(jonaDegPerSec(j) * 10) / 10 })),
    presets: angles,
    tuning: { sequenceSlotSec: tuning.slotSec, postActionDelay: tuning.postDelay },
  };
}

async function handleAdmin(method: string, path: string, req: http.IncomingMessage): Promise<unknown> {
  await requireAdmin(req);
  const b = method === 'GET' ? {} : await body(req);
  const preset = /^\/admin\/presets\/(\d+)(\/goto)?$/.exec(path);
  const key = `${method} ${preset ? '/admin/presets/:id' + (preset[2] ?? '') : path}`;
  switch (key) {
    case 'GET /admin/state':
      return adminState();
    case 'POST /admin/connect':
      if (st.busy) throw new HttpErr(409, 'Robot sedang sibuk.');
      await robot.connect();
      return adminState();
    case 'POST /admin/stop': {
      // always allowed, even during a session
      const [code, r] = await requestStop();
      if (code !== 200) throw new HttpErr(code, (r as { error: string }).error);
      return r;
    }
    case 'POST /admin/home':
      background('pulang ke home', () => robot.home());
      return { status: 'moving' };
    case 'POST /admin/move': {
      const joints = poseFrom(b.joints);
      background('bergerak', () => robot.moveJoints(joints));
      return { status: 'moving' };
    }
    case 'POST /admin/jog/start': {
      const joint = Number(b.joint);
      const dir = Number(b.dir) < 0 ? -1 : 1;
      const speed = Math.min(100, Math.max(1, Number(b.speed) || 30));
      if (!Number.isInteger(joint) || !JONA_JOINTS[joint]) throw new HttpErr(400, 'Joint tidak valid');
      claim('jog');
      manual.lastBeat = Date.now();
      try {
        await robot.connect();
        await robot.jogStart(joint, dir, speed);
      } catch (e) {
        release();
        throw new HttpErr(409, (e as Error).message);
      }
      return { status: 'jogging' };
    }
    case 'POST /admin/jog/beat':
      if (manual.what === 'jog') manual.lastBeat = Date.now();
      return { jogging: manual.what === 'jog' };
    case 'POST /admin/jog/stop':
      await jogStop();
      return adminState();
    case 'POST /admin/presets': {
      lockedBySession();
      const joints = b.joints === undefined ? await currentPose() : poseFrom(b.joints);
      const id = angles.length + 1;
      saveAngles([...angles, { id, name: cleanName(b.name, `P${id}`), position: { joints } }]);
      return { presets: angles };
    }
    case 'PUT /admin/presets/:id': {
      lockedBySession();
      const i = presetIndex(Number(preset![1]));
      const a = angles[i];
      const joints = b.joints === undefined ? null : b.joints === 'current' ? await currentPose() : poseFrom(b.joints);
      const next = [...angles];
      next[i] = { ...a, name: b.name === undefined ? a.name : cleanName(b.name, a.name), position: joints ? { ...a.position, joints } : a.position };
      saveAngles(next);
      return { presets: angles };
    }
    case 'DELETE /admin/presets/:id': {
      lockedBySession();
      const i = presetIndex(Number(preset![1]));
      if (angles.length <= 1) throw new HttpErr(400, 'Minimal harus ada satu pose');
      saveAngles(renumber(angles.filter((_, k) => k !== i)));
      return { presets: angles };
    }
    case 'POST /admin/presets/order': {
      lockedBySession();
      const ids = Array.isArray(b.ids) ? b.ids.map(Number) : [];
      if (ids.length !== angles.length || new Set(ids).size !== ids.length || !ids.every((id: number) => angles.some((a) => a.id === id)))
        throw new HttpErr(400, 'Urutan harus memuat semua pose tepat satu kali');
      saveAngles(renumber(ids.map((id: number) => angles.find((a) => a.id === id)!)));
      return { presets: angles };
    }
    case 'POST /admin/presets/:id/goto': {
      const a = angles[presetIndex(Number(preset![1]))];
      background(`ke ${a.name}`, () => robot.moveToAngle(a.id));
      return { status: 'moving' };
    }
    default:
      throw new HttpErr(404, 'not found');
  }
}

// ------------------------------------------------------------------ http

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
      if (url.startsWith('/admin/')) return send(200, await handleAdmin(req.method ?? 'GET', url, req));
      switch (key) {
        case 'GET /health': return send(200, { status: 'ok', service: 'jona-bridge' });
        case 'GET /detection':
          return send(200, { session_active: st.active, session_stopped: st.sessionStopped, face_detected: false, face_offset: null, tracking_active: false, fsm_state: st.fsm, status: st.fsm, sequence: progress(), robot: { connected: (await robot.getStatus().catch(() => null))?.connected ?? false, enabled: st.mode === 'active', current_preset: st.preset } });
        case 'GET /status': return send(200, { running: true, session_active: st.active, fsm_state: st.fsm, capture_locked: st.fsm !== 'IDLE' && st.fsm !== 'DONE', robot: { connected: true, enabled: st.mode === 'active', dry_run: !!env.JONA_MOCK } });
        case 'GET /robot/status': return send(200, modeStatus());
        case 'GET /sequence': return send(200, { fsm_state: st.fsm, ...progress() });
        case 'GET /presence': return send(200, { present: false, motion_ratio: 0 });
        case 'GET /config/runtime': return send(200, { settings: applyTuning({}) });
        case 'POST /config/runtime': return send(200, { status: 'applied', settings: applyTuning(await body(req)) });
        case 'POST /robot/enable': {
          const only = ((await body(req)).only as unknown[] | undefined)?.map(Number).filter((n) => angles.some((a) => a.id === n));
          return send(...requestEnable(only));
        }
        case 'POST /robot/disable':
          return send(...requestDisable());
        case 'POST /robot/stop':
          return send(...(await requestStop()));
        case 'POST /robot/preset': {
          const n = Number((await body(req)).preset);
          if (!angles.some((a) => a.id === n)) return send(404, { error: `preset ${n} not defined` });
          if (st.busy || st.mode !== 'standby' && st.mode !== 'active' || st.fsm === 'MOVING' || st.fsm === 'CAPTURING') return send(409, { error: 'busy — robot sedang bergerak' });
          st.busy = true;
          void robot.moveToAngle(n).catch((e) => console.warn(e.message)).finally(() => (st.busy = false));
          return send(200, { status: 'moving', preset: n });
        }
        case 'POST /sequence/skip':
          if (st.fsm !== 'TRACKING') return send(200, { status: 'ignored', ...progress() }); // no-op outside the prep window
          prepSkip = true;
          return send(200, { status: 'skipped', ...progress() });
        default: return send(404, { error: 'not found' });
      }
    } catch (e) {
      const code = e instanceof HttpErr ? e.code : 500;
      send(code, { success: false, error: (e as Error).message });
    }
  })
  .listen(PORT, () => {
    console.log(`jona-bridge on :${PORT} (${env.JONA_MOCK ? 'MOCK' : SERIAL}) → Go ${BACKEND}`);
    // Admin's robot tuning lives in Go; take it now so the first session uses it.
    fetch(`${BACKEND}/api/robot-settings`, { signal: AbortSignal.timeout(3000) })
      .then((r) => (r.ok ? r.json() : null))
      .then((o) => o && console.log('[tuning]', applyTuning(o)))
      .catch(() => console.warn('[tuning] Go not reachable yet; using env values until admin saves'));
    // Open the port now so the admin page sees the arm; moving still waits for a session or the admin.
    robot.connect().catch((e) => console.warn(`[connect] ${(e as Error).message}`));
  });
