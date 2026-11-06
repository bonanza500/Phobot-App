import net from 'node:net';
import { EventEmitter } from 'node:events';

/**
 * Physical robot abstraction (camera arm / rail / pan-tilt head).
 * The UI mascot is a separate, purely visual thing; this package moves the
 * real hardware. Angles are 1-based ids mapped to opaque physical positions
 * from configuration — no coordinates are hardcoded in the UI.
 */

export type RobotState = 'disconnected' | 'connecting' | 'idle' | 'moving' | 'homing' | 'stopped' | 'error';

export interface RobotStatus {
  state: RobotState;
  connected: boolean;
  driver: string;
  angle: number | null;
  message?: string;
  lastError?: string;
  updatedAt: string;
}

export interface RobotAngle {
  id: number;
  name: string;
  position: Record<string, unknown>;
  settleMs?: number;
}

export interface RobotController {
  readonly driver: string;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  home(): Promise<void>;
  moveToAngle(angle: number): Promise<void>;
  stop(): Promise<void>;
  getStatus(): Promise<RobotStatus>;
  setAngles(angles: RobotAngle[]): void;
}

export class RobotError extends Error {
  constructor(
    readonly code: 'ROBOT_TIMEOUT' | 'ROBOT_DISCONNECTED' | 'ROBOT_REJECTED' | 'ROBOT_UNKNOWN_ANGLE' | 'ROBOT_NOT_AVAILABLE',
    message: string,
  ) {
    super(message);
    this.name = 'RobotError';
  }
}

const now = () => new Date().toISOString();

abstract class BaseRobot implements RobotController {
  abstract readonly driver: string;
  protected angles = new Map<number, RobotAngle>();
  protected state: RobotState = 'disconnected';
  protected angle: number | null = null;
  protected lastError?: string;

  setAngles(angles: RobotAngle[]): void {
    this.angles = new Map(angles.map((a) => [a.id, a]));
  }

  protected positionFor(angle: number): RobotAngle {
    const a = this.angles.get(angle);
    if (!a) throw new RobotError('ROBOT_UNKNOWN_ANGLE', `Angle ${angle} is not configured`);
    return a;
  }

  async getStatus(): Promise<RobotStatus> {
    return {
      state: this.state,
      connected: !['disconnected', 'connecting', 'error'].includes(this.state),
      driver: this.driver,
      angle: this.angle,
      lastError: this.lastError,
      updatedAt: now(),
    };
  }

  abstract connect(): Promise<void>;
  abstract disconnect(): Promise<void>;
  abstract home(): Promise<void>;
  abstract moveToAngle(angle: number): Promise<void>;
  abstract stop(): Promise<void>;
}

// ------------------------------------------------------------------ mock

export type MockRobotFault = 'timeout' | 'disconnected' | null;

/** Simulated robot: realistic move durations, fault injection for testing. */
export class MockRobotController extends BaseRobot {
  readonly driver = 'mock';
  private fault: MockRobotFault = null;

  constructor(private readonly opts: { msPerStep?: number; minMoveMs?: number; timeoutMs?: number } = {}) {
    super();
  }

  simulateFault(f: MockRobotFault) {
    this.fault = f;
    if (f === 'disconnected') {
      this.state = 'error';
      this.lastError = 'Simulated disconnect';
    } else if (this.state === 'error') this.state = 'idle';
  }

  async connect(): Promise<void> {
    if (this.fault === 'disconnected') throw new RobotError('ROBOT_DISCONNECTED', 'Robot disconnected (simulated)');
    this.state = 'idle';
  }

  async disconnect(): Promise<void> {
    this.state = 'disconnected';
  }

  private async travel(ms: number) {
    if (this.fault === 'disconnected') throw new RobotError('ROBOT_DISCONNECTED', 'Robot disconnected (simulated)');
    if (this.fault === 'timeout') {
      await new Promise((r) => setTimeout(r, this.opts.timeoutMs ?? 200));
      this.state = 'error';
      this.lastError = 'Move timed out (simulated)';
      throw new RobotError('ROBOT_TIMEOUT', 'Robot move timed out (simulated)');
    }
    await new Promise((r) => setTimeout(r, ms));
  }

  async home(): Promise<void> {
    this.state = 'homing';
    await this.travel(this.opts.minMoveMs ?? 300);
    this.angle = null;
    this.state = 'idle';
  }

  async moveToAngle(angle: number): Promise<void> {
    const target = this.positionFor(angle);
    this.state = 'moving';
    const steps = Math.abs((this.angle ?? 1) - angle) || 1;
    await this.travel(Math.max(this.opts.minMoveMs ?? 300, steps * (this.opts.msPerStep ?? 120)));
    if (target.settleMs) await new Promise((r) => setTimeout(r, target.settleMs));
    this.angle = angle;
    this.state = 'idle';
  }

  async stop(): Promise<void> {
    this.state = 'stopped';
  }
}

// ------------------------------------------------------------------ line-delimited JSON protocol

/**
 * Wire protocol shared by the Serial, TCP and WebSocket drivers. One JSON object per line:
 *   → {"id":7,"cmd":"move","angle":3,"name":"Left","position":{"pan":-60,...}}
 *   ← {"id":7,"ok":true,"state":"idle","angle":3}
 *   ← {"id":7,"ok":false,"error":"limit switch"}
 * Commands: hello, home, move, stop, status. Unsolicited {"event":"status",...} lines are allowed.
 */
export interface Transport extends EventEmitter {
  open(): Promise<void>;
  close(): Promise<void>;
  send(line: string): void;
  readonly isOpen: boolean;
}

interface Pending {
  resolve: (v: Record<string, unknown>) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
}

export class JsonLineRobotController extends BaseRobot {
  private seq = 0;
  private pending = new Map<number, Pending>();
  private buffer = '';

  constructor(
    readonly driver: string,
    private readonly transport: Transport,
    private readonly opts: { moveTimeoutMs: number; commandTimeoutMs?: number },
  ) {
    super();
    transport.on('data', (chunk: string) => this.onData(chunk));
    transport.on('close', () => {
      this.state = 'disconnected';
      for (const [, p] of this.pending) {
        clearTimeout(p.timer);
        p.reject(new RobotError('ROBOT_DISCONNECTED', 'Robot connection closed'));
      }
      this.pending.clear();
    });
    transport.on('error', (err: Error) => {
      this.lastError = err.message;
    });
  }

  private onData(chunk: string) {
    this.buffer += chunk;
    let idx: number;
    while ((idx = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);
      if (!line) continue;
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      if (typeof msg.state === 'string') this.state = msg.state as RobotState;
      if (typeof msg.angle === 'number') this.angle = msg.angle;
      const id = typeof msg.id === 'number' ? msg.id : null;
      if (id === null) continue;
      const p = this.pending.get(id);
      if (!p) continue;
      this.pending.delete(id);
      clearTimeout(p.timer);
      if (msg.ok === false) p.reject(new RobotError('ROBOT_REJECTED', String(msg.error ?? 'Robot rejected command')));
      else p.resolve(msg);
    }
    if (this.buffer.length > 1_000_000) this.buffer = '';
  }

  private request(cmd: string, extra: Record<string, unknown>, timeoutMs: number): Promise<Record<string, unknown>> {
    if (!this.transport.isOpen) return Promise.reject(new RobotError('ROBOT_DISCONNECTED', 'Robot not connected'));
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new RobotError('ROBOT_TIMEOUT', `Robot did not answer "${cmd}" within ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.transport.send(JSON.stringify({ id, cmd, ...extra }) + '\n');
    });
  }

  async connect(): Promise<void> {
    if (this.transport.isOpen) return;
    this.state = 'connecting';
    try {
      await this.transport.open();
      await this.request('hello', {}, this.opts.commandTimeoutMs ?? 3000).catch(() => undefined);
      this.state = 'idle';
    } catch (err) {
      this.state = 'error';
      this.lastError = (err as Error).message;
      throw new RobotError('ROBOT_DISCONNECTED', `Cannot connect to robot: ${(err as Error).message}`);
    }
  }

  async disconnect(): Promise<void> {
    await this.transport.close();
    this.state = 'disconnected';
  }

  async home(): Promise<void> {
    this.state = 'homing';
    await this.request('home', {}, this.opts.moveTimeoutMs);
    this.angle = null;
    this.state = 'idle';
  }

  async moveToAngle(angle: number): Promise<void> {
    const a = this.positionFor(angle);
    this.state = 'moving';
    try {
      await this.request('move', { angle, name: a.name, position: a.position }, this.opts.moveTimeoutMs);
      this.angle = angle;
      this.state = 'idle';
      if (a.settleMs) await new Promise((r) => setTimeout(r, a.settleMs));
    } catch (err) {
      this.state = 'error';
      this.lastError = (err as Error).message;
      throw err;
    }
  }

  async stop(): Promise<void> {
    await this.request('stop', {}, this.opts.commandTimeoutMs ?? 3000);
    this.state = 'stopped';
  }

  async getStatus(): Promise<RobotStatus> {
    if (this.transport.isOpen && !['moving', 'homing'].includes(this.state)) {
      await this.request('status', {}, this.opts.commandTimeoutMs ?? 2000).catch((e) => {
        this.lastError = (e as Error).message;
      });
    }
    return super.getStatus();
  }
}

export class TcpTransport extends EventEmitter implements Transport {
  private socket: net.Socket | null = null;
  constructor(
    private readonly host: string,
    private readonly port: number,
  ) {
    super();
  }
  get isOpen() {
    return !!this.socket && !this.socket.destroyed;
  }
  open(): Promise<void> {
    return new Promise((resolve, reject) => {
      const s = net.createConnection({ host: this.host, port: this.port });
      s.setEncoding('utf8');
      s.setKeepAlive(true, 5000);
      const fail = (e: Error) => reject(e);
      s.once('error', fail);
      s.setTimeout(5000, () => s.destroy(new Error('TCP connect timeout')));
      s.once('connect', () => {
        s.setTimeout(0);
        s.off('error', fail);
        s.on('error', (e) => this.emit('error', e));
        s.on('data', (d) => this.emit('data', d));
        s.on('close', () => this.emit('close'));
        this.socket = s;
        resolve();
      });
    });
  }
  async close() {
    this.socket?.end();
    this.socket?.destroy();
    this.socket = null;
  }
  send(line: string) {
    this.socket?.write(line);
  }
}

export class WebSocketTransport extends EventEmitter implements Transport {
  private ws: import('ws').WebSocket | null = null;
  constructor(private readonly url: string) {
    super();
  }
  get isOpen() {
    return !!this.ws && this.ws.readyState === 1;
  }
  async open(): Promise<void> {
    const { WebSocket } = await import('ws');
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(this.url, { handshakeTimeout: 5000 });
      ws.once('open', () => {
        this.ws = ws;
        resolve();
      });
      ws.once('error', reject);
      ws.on('message', (d) => this.emit('data', d.toString().endsWith('\n') ? d.toString() : d.toString() + '\n'));
      ws.on('close', () => this.emit('close'));
    });
  }
  async close() {
    this.ws?.close();
    this.ws = null;
  }
  send(line: string) {
    this.ws?.send(line.trimEnd());
  }
}

/** USB vendor id of STMicroelectronics: the STM32 virtual COM port of the Jona board. */
const STM32_VENDOR_ID = '0483';

export class SerialTransport extends EventEmitter implements Transport {
  private port: { isOpen: boolean; write(d: string): void; close(cb?: () => void): void } | null = null;
  /** Port actually opened (differs from the requested one when that is "auto"). */
  current: string;
  /** path "auto" = the first STM32 USB serial port; COM numbers change with the USB socket. */
  constructor(
    private readonly path: string,
    private readonly baudRate: number,
  ) {
    super();
    this.current = path;
  }
  get isOpen() {
    return !!this.port?.isOpen;
  }
  async open(): Promise<void> {
    let mod: {
      SerialPort: (new (o: { path: string; baudRate: number; autoOpen: boolean }) => any) & { list(): Promise<{ path: string; vendorId?: string; manufacturer?: string }[]> };
    };
    try {
      mod = (await import('serialport')) as never;
    } catch {
      throw new RobotError('ROBOT_NOT_AVAILABLE', 'The "serialport" package is not installed (npm i serialport -w @photobooth/robot)');
    }
    let path = this.path;
    if (path.toLowerCase() === 'auto') {
      const ports = await mod.SerialPort.list();
      const stm = ports.find((p) => p.vendorId?.toLowerCase() === STM32_VENDOR_ID);
      if (!stm) throw new RobotError('ROBOT_DISCONNECTED', `Board STM32 tidak ditemukan di USB (port yang ada: ${ports.map((p) => p.path).join(', ') || 'tidak ada'})`);
      path = stm.path;
    }
    this.current = path;
    const port = new mod.SerialPort({ path, baudRate: this.baudRate, autoOpen: false });
    await new Promise<void>((resolve, reject) => port.open((err: Error | null) => (err ? reject(err) : resolve())));
    port.setEncoding?.('utf8');
    port.on('data', (d: Buffer | string) => this.emit('data', d.toString()));
    port.on('close', () => this.emit('close'));
    port.on('error', (e: Error) => this.emit('error', e));
    this.port = port;
  }
  async close() {
    await new Promise<void>((r) => (this.port ? this.port.close(() => r()) : r()));
    this.port = null;
  }
  send(line: string) {
    this.port?.write(line);
  }
}

// ------------------------------------------------------------------ Jona (STM32 USB CDC, plain text)

/** Per-joint spec. Gear ratios/pulses must match App/Robotconfig.h; limits mirror its JOINT_LIMIT_*. */
export interface JonaJoint {
  pulsePerRev: number;
  gearRatio: number;
  halfPeriodUs: number; // cruise speed, = JOINT_DEFAULT_HALF_PERIOD_US
  limitDeg: [number, number];
  motor: number; // = JOINT_TO_MOTOR (V: takes a motor index, JA:/JG: take joints)
}
export const JONA_JOINTS: JonaJoint[] = [
  { pulsePerRev: 2000, gearRatio: 50, halfPeriodUs: 100, limitDeg: [-170, 170], motor: 4 },
  { pulsePerRev: 2000, gearRatio: 100, halfPeriodUs: 100, limitDeg: [-95, 90], motor: 5 },
  { pulsePerRev: 2000, gearRatio: 40, halfPeriodUs: 100, limitDeg: [-89, 107], motor: 3 },
  { pulsePerRev: 1600, gearRatio: 30, halfPeriodUs: 150, limitDeg: [-180, 215], motor: 0 },
  { pulsePerRev: 1600, gearRatio: 15, halfPeriodUs: 150, limitDeg: [-227, 105], motor: 1 },
  { pulsePerRev: 1600, gearRatio: 10, halfPeriodUs: 150, limitDeg: [-180, 180], motor: 2 },
];

/** Firmware ramps the first/last 5% of every move at constant acceleration (RAMP_FRACTION): ~1.05x slower than cruise overall. */
const RAMP_TIME_FACTOR = 1.05;
/** Slowest hold-jog speed, as a half period (firmware accepts >= 100 us). */
const MAX_JOG_HALF_PERIOD_US = 3000;

/** Cruise speed of a joint in degrees per second. */
export const jonaDegPerSec = (j: JonaJoint) => 360 / (j.pulsePerRev * j.gearRatio * 2 * j.halfPeriodUs * 1e-6);

/** Throws if a pose is not 6 finite numbers inside the firmware limits. */
export function checkJonaPose(degs: unknown, what = 'Pose'): number[] {
  if (!Array.isArray(degs) || degs.length !== JONA_JOINTS.length || !degs.every((v) => typeof v === 'number' && Number.isFinite(v)))
    throw new RobotError('ROBOT_UNKNOWN_ANGLE', `${what} needs ${JONA_JOINTS.length} joint angles`);
  degs.forEach((v: number, i) => {
    const [lo, hi] = JONA_JOINTS[i].limitDeg;
    if (v < lo || v > hi) throw new RobotError('ROBOT_REJECTED', `${what}: J${i + 1} ${v}° outside [${lo}, ${hi}]`);
  });
  return degs as number[];
}

/** Manual control used by the admin page (jog joint by joint, save poses). */
export interface JointsState {
  deg: number[];
  moving: boolean;
  jogging: number | null;
}
export interface ManualArm {
  /** Joint angles. Asks the firmware only while the arm is still. */
  readJoints(): Promise<JointsState>;
  /** Coordinated move of all joints to absolute degrees; resolves on arrival. */
  moveJoints(degs: number[]): Promise<void>;
  /** Start turning one joint toward its limit at speedPct of cruise. Stop with jogStop. */
  jogStart(joint: number, dir: 1 | -1, speedPct: number): Promise<void>;
  jogStop(): Promise<void>;
}

const busyError = () => new RobotError('ROBOT_REJECTED', 'Robot is moving');
const jogHalfPeriod = (j: JonaJoint, speedPct: number) =>
  Math.min(MAX_JOG_HALF_PERIOD_US, Math.max(100, Math.round((j.halfPeriodUs * 100) / Math.min(100, Math.max(1, speedPct)))));

/** Simulated Jona for JONA_MOCK: moves at the real cruise speeds. */
export class MockJonaController extends MockRobotController implements ManualArm {
  private deg = JONA_JOINTS.map(() => 0);
  private jog: { joint: number; dir: number; degPerSec: number; t0: number } | null = null;
  private moving = false;
  private stops = 0;
  private moves = 0;

  private jogged() {
    if (!this.jog) return this.deg;
    const { joint, dir, degPerSec, t0 } = this.jog;
    const [lo, hi] = JONA_JOINTS[joint].limitDeg;
    const d = [...this.deg];
    d[joint] = Math.min(hi, Math.max(lo, d[joint] + (dir * degPerSec * (Date.now() - t0)) / 1000));
    return d;
  }
  async readJoints(): Promise<JointsState> {
    return { deg: this.jogged().map((v) => Math.round(v * 100) / 100), moving: this.moving || !!this.jog, jogging: this.jog?.joint ?? null };
  }
  async moveJoints(degs: number[]) {
    checkJonaPose(degs);
    if (this.moving || this.jog) throw busyError();
    const from = [...this.deg];
    const ms = Math.max(...degs.map((v, i) => Math.abs(v - from[i]) / jonaDegPerSec(JONA_JOINTS[i]))) * RAMP_TIME_FACTOR * 1000;
    const stops = this.stops;
    const t0 = Date.now();
    const mine = ++this.moves;
    this.moving = true;
    try {
      while (Date.now() - t0 < ms) {
        await new Promise((r) => setTimeout(r, Math.min(50, ms - (Date.now() - t0))));
        if (this.stops !== stops) {
          // Halt where the arm is now, like the firmware e-stop.
          const f = Math.min(1, (Date.now() - t0) / ms);
          this.deg = from.map((v, i) => Math.round((v + (degs[i] - v) * f) * 100) / 100);
          throw new RobotError('ROBOT_REJECTED', 'Stopped');
        }
      }
      this.deg = [...degs];
    } finally {
      if (mine === this.moves) this.moving = false;
    }
  }
  async jogStart(joint: number, dir: 1 | -1, speedPct: number) {
    if (this.moving || this.jog) throw busyError();
    const j = JONA_JOINTS[joint];
    this.jog = { joint, dir, degPerSec: jonaDegPerSec({ ...j, halfPeriodUs: jogHalfPeriod(j, speedPct) }), t0: Date.now() };
  }
  async jogStop() {
    this.deg = this.jogged();
    this.jog = null;
  }
  async home() {
    await this.moveJoints(JONA_JOINTS.map(() => 0));
    await super.home();
  }
  async moveToAngle(angle: number) {
    const j = this.positionFor(angle).position.joints;
    if (Array.isArray(j)) await this.moveJoints(checkJonaPose(j, `Angle ${angle}`));
    await super.moveToAngle(angle);
  }
  async stop() {
    this.stops++;
    this.moving = false; // the move in flight notices within 50 ms and throws
    await this.jogStop();
    await super.stop();
  }
}

/**
 * Driver for the Jona firmware in D:\VSCode\Jona Software (text lines over USB CDC):
 *   → HOME | JG:j0:..:j5 (absolute deg) | ?  | ' ' (bare space = e-stop, no newline)
 *   ← "J0 (M5):  deg  step=0  tgt=0  v=300 us" x6 for "?"   |   "ERR: ..." / "IK FAIL"
 * Never send lowercase a d w s q e (firmware jog keys): numbers use toFixed, never exponent form.
 * "?" makes the firmware print with blocking calls, which stutters the steppers, so a move is:
 * poll once while still, send, stay silent for the estimated travel time, poll once to confirm.
 */
export class JonaRobotController extends BaseRobot implements ManualArm {
  readonly driver = 'jona';
  private buffer = '';
  private fw = new Map<number, { step: number; tgt: number; v: number }>();
  private lastErr: string | null = null;
  private lastWrite = 0;
  private pollQueue: Promise<unknown> = Promise.resolve();
  private jogging: number | null = null;
  private stops = 0;
  private runs = 0;
  /** The firmware answered the last status question. */
  private alive = false;

  constructor(
    private readonly transport: Transport,
    private readonly opts: { moveTimeoutMs: number },
  ) {
    super();
    transport.on('data', (c: string) => this.onData(c));
    transport.on('close', () => {
      this.alive = false;
      this.state = 'disconnected';
    });
    transport.on('error', (e: Error) => (this.lastError = e.message));
  }

  private onData(chunk: string) {
    this.buffer += chunk;
    let i: number;
    while ((i = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, i).trim();
      this.buffer = this.buffer.slice(i + 1);
      const m = /^J(\d) \(M\d+\):.*step=(-?\d+)\s+tgt=(-?\d+)\s+v=(\d+)/.exec(line);
      if (m) this.fw.set(+m[1], { step: +m[2], tgt: +m[3], v: +m[4] });
      else if (/^ERR|IK FAIL/.test(line)) this.lastErr = line;
    }
    if (this.buffer.length > 100_000) this.buffer = '';
  }

  private sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  private steps = (i: number, deg: number) => Math.round((deg / 360) * JONA_JOINTS[i].pulsePerRev * JONA_JOINTS[i].gearRatio);

  /** The firmware does not split its input on newlines: two lines arriving together merge into one bad command. Keep them apart. */
  private async send(cmd: string) {
    if (!this.transport.isOpen) throw new RobotError('ROBOT_DISCONNECTED', 'Robot not connected');
    const wait = this.lastWrite + 40 - Date.now();
    if (wait > 0) await this.sleep(wait);
    this.transport.send(cmd + '\n');
    this.lastWrite = Date.now();
  }

  /** Ask the firmware where every joint is. One question at a time (the admin page and a move may both ask). */
  private poll(): Promise<void> {
    const p = this.pollQueue.then(async () => {
      this.fw.clear();
      await this.send('?');
      for (let t = 0; t < 30 && this.fw.size < JONA_JOINTS.length; t++) await this.sleep(50);
      this.alive = this.fw.size === JONA_JOINTS.length;
      if (!this.alive) throw new RobotError('ROBOT_TIMEOUT', 'Jona tidak menjawab status (cek kabel USB / firmware)');
    });
    this.pollQueue = p.catch(() => undefined);
    return p;
  }

  private toDeg = (i: number, steps: number) => Math.round(((steps * 360) / (JONA_JOINTS[i].pulsePerRev * JONA_JOINTS[i].gearRatio)) * 100) / 100;
  private busy = () => this.state === 'moving' || this.state === 'homing' || this.jogging !== null;

  private idle = () => [...this.fw.values()].every((j) => j.step === j.tgt);

  /** Move every joint to absolute degrees. Confirms with the firmware's own target, so a dropped command is retried. */
  private async goto(degs: number[], cmd: string) {
    const want = degs.map((d, i) => this.steps(i, d));
    const stops = this.stops;
    // After an e-stop the firmware target no longer matches; that must end the move, not trigger a resend.
    const halted = () => {
      if (this.stops !== stops) throw new RobotError('ROBOT_REJECTED', 'Stopped');
    };
    for (let attempt = 0; attempt < 2; attempt++) {
      halted();
      await this.poll(); // arm is still here: no stutter
      let est = 0;
      want.forEach((w, i) => {
        const j = this.fw.get(i)!;
        est = Math.max(est, Math.abs(w - j.tgt) * 2 * JONA_JOINTS[i].halfPeriodUs * 1e-6);
      });
      if (want.every((w, i) => Math.abs(this.fw.get(i)!.tgt - w) <= 2) && this.idle()) return; // already there
      this.lastErr = null;
      await this.send(cmd);
      const travelEnd = Date.now() + est * RAMP_TIME_FACTOR * 1000 + 300;
      while (Date.now() < travelEnd) {
        halted();
        await this.sleep(Math.min(100, travelEnd - Date.now()));
      }
      const end = Date.now() + this.opts.moveTimeoutMs;
      for (;;) {
        halted();
        await this.poll();
        halted();
        if (this.lastErr) throw new RobotError('ROBOT_REJECTED', this.lastErr);
        if (!want.every((w, i) => Math.abs(this.fw.get(i)!.tgt - w) <= 2)) break; // command not applied → retry
        if (this.idle()) return;
        if (Date.now() > end) throw new RobotError('ROBOT_TIMEOUT', `Jona move not finished within ${this.opts.moveTimeoutMs}ms`);
        await this.sleep(400); // still stepping (slower than estimated): poll rarely
      }
    }
    throw new RobotError('ROBOT_REJECTED', this.lastErr ?? 'Jona did not accept the move');
  }

  private async run(state: RobotState, degs: number[], cmd: string) {
    // A stopped move notices the stop a moment later; by then a new move may own the state.
    const mine = ++this.runs;
    this.state = state;
    try {
      await this.goto(degs, cmd);
      if (mine === this.runs) this.state = 'idle';
    } catch (err) {
      if (mine === this.runs) {
        this.state = this.stopsSeen(err) ? 'stopped' : 'error';
        this.lastError = (err as Error).message;
      }
      throw err;
    }
  }
  private stopsSeen = (err: unknown) => (err as Error).message === 'Stopped';

  /** Connected = port open AND the firmware answered. An open port alone proves nothing. */
  async connect(): Promise<void> {
    if (this.transport.isOpen && this.alive) return;
    if (this.busy()) return; // a move in progress owns the line; it reports its own failure
    this.state = 'connecting';
    try {
      if (!this.transport.isOpen) {
        await this.transport.open();
        await this.sleep(300);
      }
      // Leftover characters in the firmware's input buffer (another program, a half-sent line)
      // swallow the first "?". Its newline clears them, so the next one is answered.
      for (let i = 0; ; i++) {
        try {
          await this.poll();
          break;
        } catch (err) {
          if (i >= 2) throw err;
          await this.sleep(200);
        }
      }
      this.state = 'idle';
    } catch (err) {
      this.state = 'error';
      this.lastError = (err as Error).message;
      throw new RobotError('ROBOT_DISCONNECTED', `Cannot connect to Jona: ${(err as Error).message}`);
    }
  }

  async disconnect(): Promise<void> {
    await this.transport.close();
    this.alive = false;
    this.state = 'disconnected';
  }

  /** A failed move leaves state 'error' but the link may be fine: report the link, not the last move. */
  async getStatus(): Promise<RobotStatus> {
    const s = await super.getStatus();
    return { ...s, connected: this.transport.isOpen && this.alive };
  }

  async home(): Promise<void> {
    await this.run('homing', JONA_JOINTS.map(() => 0), 'HOME');
    this.angle = null;
  }

  async moveToAngle(angle: number): Promise<void> {
    const a = this.positionFor(angle);
    await this.moveJoints(checkJonaPose(a.position.joints, `Angle ${angle}`));
    this.angle = angle;
    if (a.settleMs) await this.sleep(a.settleMs);
  }

  async moveJoints(degs: number[]): Promise<void> {
    checkJonaPose(degs);
    if (this.busy()) throw busyError();
    await this.run('moving', degs, `JG:${degs.map((v) => v.toFixed(2)).join(':')}`);
    this.angle = null;
  }

  async readJoints(): Promise<JointsState> {
    if (this.transport.isOpen && !this.busy()) await this.poll();
    return {
      deg: JONA_JOINTS.map((_, i) => this.toDeg(i, this.fw.get(i)?.step ?? 0)),
      moving: this.busy() || !this.idle(),
      jogging: this.jogging,
    };
  }

  /** V: sets the motor speed (JA: keeps whatever speed the last JG left), then JA: to the joint limit. jogStop halts it. */
  async jogStart(joint: number, dir: 1 | -1, speedPct: number): Promise<void> {
    const j = JONA_JOINTS[joint];
    if (!j) throw new RobotError('ROBOT_REJECTED', `No joint ${joint}`);
    if (this.busy()) throw busyError();
    await this.poll();
    if (!this.idle()) throw busyError();
    const limit = j.limitDeg[dir > 0 ? 1 : 0];
    if (Math.abs(this.toDeg(joint, this.fw.get(joint)!.step) - limit) < 0.05) throw new RobotError('ROBOT_REJECTED', `J${joint + 1} is at its limit`);
    this.jogging = joint;
    this.state = 'moving';
    try {
      await this.send(`V:${j.motor}:${jogHalfPeriod(j, speedPct)}`);
      await this.send(`JA:${joint}:${limit.toFixed(2)}`);
    } catch (err) {
      await this.jogStop();
      throw err;
    }
  }

  async jogStop(): Promise<void> {
    if (this.jogging === null) return;
    if (this.transport.isOpen) this.transport.send(' '); // e-stop: every target = current position
    this.jogging = null;
    await this.sleep(150);
    await this.poll().catch(() => undefined);
    this.state = 'idle';
  }

  async stop(): Promise<void> {
    if (this.transport.isOpen) this.transport.send(' ');
    this.stops++;
    this.jogging = null;
    this.state = 'stopped';
  }
}

// ------------------------------------------------------------------ REST

/**
 * REST controller: POST {url}/home, POST {url}/move {angle,name,position},
 * POST {url}/stop, GET {url}/status → {state, angle}.
 * The move request must return when the robot has arrived (or 4xx/5xx on failure).
 */
export class RestRobotController extends BaseRobot {
  readonly driver = 'rest';
  constructor(
    private readonly url: string,
    private readonly opts: { moveTimeoutMs: number; token?: string },
  ) {
    super();
  }

  private async call(method: string, p: string, body?: unknown, timeoutMs = 5000): Promise<Record<string, unknown>> {
    let res: Response;
    try {
      res = await fetch(`${this.url.replace(/\/+$/, '')}${p}`, {
        method,
        headers: { 'content-type': 'application/json', ...(this.opts.token ? { authorization: `Bearer ${this.opts.token}` } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      const e = err as Error;
      if (e.name === 'TimeoutError') throw new RobotError('ROBOT_TIMEOUT', `Robot REST ${p} timed out`);
      throw new RobotError('ROBOT_DISCONNECTED', `Robot REST unreachable: ${e.message}`);
    }
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok || json.ok === false) throw new RobotError('ROBOT_REJECTED', String(json.error ?? `HTTP ${res.status}`));
    if (typeof json.state === 'string') this.state = json.state as RobotState;
    if (typeof json.angle === 'number') this.angle = json.angle;
    return json;
  }

  async connect() {
    this.state = 'connecting';
    try {
      await this.call('GET', '/status');
      if (this.state === 'connecting') this.state = 'idle';
    } catch (err) {
      this.state = 'error';
      this.lastError = (err as Error).message;
      throw err;
    }
  }
  async disconnect() {
    this.state = 'disconnected';
  }
  async home() {
    this.state = 'homing';
    await this.call('POST', '/home', {}, this.opts.moveTimeoutMs);
    this.state = 'idle';
    this.angle = null;
  }
  async moveToAngle(angle: number) {
    const a = this.positionFor(angle);
    this.state = 'moving';
    try {
      await this.call('POST', '/move', { angle, name: a.name, position: a.position }, this.opts.moveTimeoutMs);
      this.state = 'idle';
      this.angle = angle;
      if (a.settleMs) await new Promise((r) => setTimeout(r, a.settleMs));
    } catch (err) {
      this.state = 'error';
      this.lastError = (err as Error).message;
      throw err;
    }
  }
  async stop() {
    await this.call('POST', '/stop', {});
    this.state = 'stopped';
  }
  async getStatus(): Promise<RobotStatus> {
    if (!['moving', 'homing'].includes(this.state)) {
      await this.call('GET', '/status').catch((e) => {
        this.state = 'error';
        this.lastError = (e as Error).message;
      });
    }
    return super.getStatus();
  }
}

// ------------------------------------------------------------------ MQTT

/**
 * MQTT controller: publishes `{id,cmd,...}` to `<topic>/cmd`, expects replies on
 * `<topic>/resp` with the same id (same JSON as the line protocol).
 */
export class MqttTransport extends EventEmitter implements Transport {
  private client: { connected: boolean; publish(t: string, m: string): void; end(f?: boolean): void } | null = null;
  constructor(
    private readonly url: string,
    private readonly topic: string,
    private readonly auth: { username?: string; password?: string } = {},
  ) {
    super();
  }
  get isOpen() {
    return !!this.client?.connected;
  }
  async open(): Promise<void> {
    let mqtt: { connect: (url: string, o: object) => any };
    try {
      mqtt = (await import('mqtt')) as never;
    } catch {
      throw new RobotError('ROBOT_NOT_AVAILABLE', 'The "mqtt" package is not installed');
    }
    const connectFn = mqtt.connect ?? (mqtt as unknown as { default: { connect: typeof mqtt.connect } }).default.connect;
    await new Promise<void>((resolve, reject) => {
      const c = connectFn(this.url, { ...this.auth, connectTimeout: 5000, reconnectPeriod: 2000 });
      c.once('connect', () => {
        c.subscribe(`${this.topic}/resp`);
        this.client = c;
        resolve();
      });
      c.once('error', reject);
      c.on('message', (_t: string, m: Buffer) => this.emit('data', m.toString() + '\n'));
      c.on('close', () => this.emit('close'));
    });
  }
  async close() {
    this.client?.end(true);
    this.client = null;
  }
  send(line: string) {
    this.client?.publish(`${this.topic}/cmd`, line.trimEnd());
  }
}

// ------------------------------------------------------------------ factory

export interface RobotConfig {
  driver: 'mock' | 'jona' | 'serial' | 'tcp' | 'websocket' | 'rest' | 'mqtt';
  host: string;
  port: number;
  serialPort: string;
  baudRate: number;
  url: string;
  mqttTopic: string;
  moveTimeoutMs: number;
  token?: string;
  mqttUsername?: string;
  mqttPassword?: string;
}

export function createRobotController(cfg: RobotConfig): RobotController {
  const opts = { moveTimeoutMs: cfg.moveTimeoutMs };
  switch (cfg.driver) {
    case 'jona':
      return new JonaRobotController(new SerialTransport(cfg.serialPort, cfg.baudRate), opts);
    case 'serial':
      return new JsonLineRobotController('serial', new SerialTransport(cfg.serialPort, cfg.baudRate), opts);
    case 'tcp':
      return new JsonLineRobotController('tcp', new TcpTransport(cfg.host, cfg.port), opts);
    case 'websocket':
      return new JsonLineRobotController('websocket', new WebSocketTransport(cfg.url || `ws://${cfg.host}:${cfg.port}`), opts);
    case 'rest':
      return new RestRobotController(cfg.url || `http://${cfg.host}:${cfg.port}`, { ...opts, token: cfg.token });
    case 'mqtt':
      return new JsonLineRobotController(
        'mqtt',
        new MqttTransport(cfg.url || `mqtt://${cfg.host}:${cfg.port || 1883}`, cfg.mqttTopic, {
          username: cfg.mqttUsername,
          password: cfg.mqttPassword,
        }),
        opts,
      );
    case 'mock':
    default:
      return new MockRobotController();
  }
}
