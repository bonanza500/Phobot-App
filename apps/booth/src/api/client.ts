import {
  activePhotos,
  autoPick,
  canRetake,
  CAPTURE_STATES,
  DEFAULT_ANGLES,
  DEFAULT_SETTINGS,
  DEFAULT_TEMPLATES,
  defaultEdit,
  type BoothConfig,
  type HealthReport,
  type PhotoDTO,
  type PhotoTemplate,
  type SessionCommand,
  type SessionCreated,
  type SessionSnapshot,
  type SessionState,
} from '@photobooth/shared';
import { composeFrame } from '../compose';

/**
 * Booth ↔ glambot adapter. The booth UI keeps talking in SessionSnapshots and
 * commands; this module runs that state machine locally in the browser and maps
 * it onto the glambot Go backend (:8080, proxied by Vite) and the dobot Flask
 * service (:5001). Go stays the source of truth for payment, photos, frames,
 * compose and print.
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly userMessage?: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export class NetworkError extends Error {
  readonly code = 'BACKEND_UNAVAILABLE';
  readonly userMessage = 'Sistem sedang menyambung ulang…';
}

type ConnListener = (online: boolean) => void;
const connListeners = new Set<ConnListener>();
let failures = 0;
function reportNetwork(ok: boolean) {
  const before = failures;
  failures = ok ? 0 : failures + 1;
  if (ok && before >= 2) connListeners.forEach((l) => l(true));
  if (!ok && failures === 2) connListeners.forEach((l) => l(false));
}
export function onConnectivity(l: ConnListener): () => void {
  connListeners.add(l);
  return () => connListeners.delete(l);
}

export const newRequestId = () =>
  (crypto as Crypto & { randomUUID?: () => string }).randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const env = import.meta.env as Record<string, string | undefined>;
const host = () => `${location.protocol}//${location.hostname}`;
export const ROBOT_URL = env.VITE_ROBOT_URL?.trim() || '/dobot';
const DOWNLOAD_URL = () => env.VITE_DOWNLOAD_PUBLIC_URL?.trim() || `${host()}:3000`;

/**
 * QR target + QR-screen preview, same rules as glambot GetPhotosScreen:
 * QR = public Google Drive folder when Drive is on (≤45s wait), else the local
 * /download-photos page. Preview = live strip GIF → framed strip → slideshow GIF,
 * preloaded so it shows at once; undefined when nothing loads (screen falls back).
 */
async function galleryLinks(goId: string, strip?: string): Promise<{ url: string; preview?: string }> {
  const base = `/api/photo/session/${goId}`;
  const poll = async <T>(path: string, done: (v: T) => boolean, ms: number, every: number) => {
    const end = Date.now() + ms;
    for (;;) {
      const v = await go<T>('GET', path).catch(() => null);
      if ((v && done(v)) || Date.now() + every > end) return v;
      await sleep(every);
    }
  };
  const drive = poll<{ enabled: boolean; ready: boolean; url: string }>(`${base}/drive`, (d) => !d.enabled || d.ready, 45000, 2000);
  const preview = (async () => {
    const live = await poll<{ available: boolean }>(`${base}/gif-live/available`, (a) => a.available, 15000, 1200);
    const src = live?.available ? `${base}/gif-live?inline=1` : strip || `${base}/gif?inline=1`;
    // The first hit may 404/500 while the backend still renders the GIF: retry.
    for (let i = 0; i < 4; i++) {
      const ok = await new Promise<boolean>((res) => {
        const img = new Image();
        img.onload = () => res(true);
        img.onerror = () => res(false);
        setTimeout(() => res(false), 20000);
        img.src = src;
      });
      if (ok) return src;
      await sleep(1500);
    }
    return undefined;
  })();
  const [d, p] = await Promise.all([drive, preview]);
  return { url: d?.enabled && d.ready && d.url ? d.url : `${DOWNLOAD_URL()}/download-photos/${goId}`, preview: p };
}

/* ------------------------------------------------------------------ Go HTTP */

async function go<T>(method: string, path: string, body?: unknown, form?: FormData, timeoutMs = 20000): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: form ?? (body !== undefined ? JSON.stringify(body) : undefined),
      signal: AbortSignal.timeout(timeoutMs),
      cache: 'no-store',
    });
  } catch (e) {
    reportNetwork(false);
    throw new NetworkError((e as Error).message);
  }
  const j = (await res.json().catch(() => null)) as { success?: boolean; data?: unknown; error?: string } | null;
  if (!j && res.status >= 500) {
    // Vite proxy answers 5xx without JSON when Go is down.
    reportNetwork(false);
    throw new NetworkError(`HTTP ${res.status}`);
  }
  reportNetwork(true);
  if (!res.ok || j?.success === false) {
    const msg = j?.error || res.statusText || `HTTP ${res.status}`;
    throw new ApiError(res.status, `HTTP_${res.status}`, msg, msg, res.status >= 500);
  }
  return (j && typeof j === 'object' && 'data' in j ? j.data : j) as T;
}

interface GoPackage { id: number; code: string; price: number; duration_secs: number; is_popular: boolean; print_unit_price: number }
interface GoSession { id: string; final_price: number; status: string; expires_at: string }
interface GoTx { midtrans_order_id: string; status: string; qris_raw_string?: string; qris_url?: string; paid_at?: string }
interface GoPhoto { id: string; url?: string; file_path: string; created_at: string }
interface GoFrame {
  id: string;
  name: string;
  file_path: string;
  thumb_url: string;
  canvas_width: number;
  canvas_height: number;
  slots: { x: number; y: number; width: number; height: number; shape: string }[] | null;
}
export interface RobotDetection {
  fsm_state?: 'IDLE' | 'MOVING' | 'TRACKING' | 'CAPTURING' | 'DONE';
  sequence?: { index: number; total: number; seconds_left: number; complete: boolean };
}
export interface RobotConfig { current_preset: number; auto_capture_active: boolean; auto_capture_remaining_ms: number }

function frameToTemplate(f: GoFrame): PhotoTemplate {
  const width = f.canvas_width || 464;
  const height = f.canvas_height || 696;
  const slots = Array.isArray(f.slots) ? f.slots : [];
  return {
    id: f.id,
    name: f.name,
    photoCount: slots.length,
    columns: 1,
    rows: slots.length,
    aspectRatio: width / height,
    background: '#FFFFFF',
    slotStyle: 'square',
    label: '',
    labelColor: '#2B2A4C',
    enabled: true,
    // Keep /storage same-origin (via proxy) so the compose canvas is not tainted.
    overlay: { image: (f.thumb_url || f.file_path).replace(/^https?:\/\/[^/]+(?=\/storage\/)/, ''), width, height, slots },
  };
}

/* ------------------------------------------------------------------ local session */

const STORE_KEY = 'pb.glambot';
const PAID_FAIL = new Set(['failed', 'expired', 'cancel', 'deny']);
const UNPAID: SessionState[] = ['SELECT_PRINT', 'WAITING_PAYMENT', 'PAYMENT_FAILED'];
const BACK: Partial<Record<SessionState, SessionState>> = {
  PHOTO_SELECTION: 'REVIEW',
  EDITING: 'PHOTO_SELECTION',
  FINAL_PREVIEW: 'EDITING',
};

function invalid(st: SessionState, cmd: string): never {
  throw new ApiError(409, 'INVALID_TRANSITION', `${cmd} not allowed in ${st}`);
}

class Api {
  token: string | null = null;
  sessionId: string | null = null;
  /** Current glambot (Go) session id. A new one is created per payment attempt. */
  goId: string | null = null;
  private orderId: string | null = null;
  private snap: SessionSnapshot | null = null;
  private pkg: GoPackage | null = null;
  private templates: PhotoTemplate[] = [];
  private packageDurationSecs = 600;
  private listeners = new Set<(s: SessionSnapshot) => void>();
  private poll: ReturnType<typeof setInterval> | undefined;
  private paySeq = 0;
  /** Safety cap for the robot sequence: package duration + 1 min grace. */
  get captureLimitMs() {
    return (this.packageDurationSecs + 60) * 1000;
  }

  constructor() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null') as { snap: SessionSnapshot; goId: string | null; orderId: string | null } | null;
      if (saved?.snap) {
        const st = saved.snap.status;
        // Restart mid-flow: capture re-observes the robot, a half-done render is redone.
        // A cut-off retake returns to Review (its chance is already spent).
        const status: SessionState = st === 'RETAKE' || st === 'SESSION_COMPLETE' ? 'REVIEW' : CAPTURE_STATES.has(st) ? 'READY' : ['RENDERING', 'PRINTING'].includes(st) ? 'FINAL_PREVIEW' : st;
        this.snap = { ...saved.snap, status };
        this.sessionId = saved.snap.id;
        this.token = 'local';
        this.goId = saved.goId;
        this.orderId = saved.orderId;
        if (status === 'WAITING_PAYMENT') this.startPoll();
        if (st === 'RETAKE') void go('POST', '/api/robot/disable').catch(() => undefined);
      }
    } catch {
      /* ignore */
    }
  }

  private emit(patch: Partial<SessionSnapshot>) {
    if (!this.snap) return this.snap!;
    this.snap = { ...this.snap, ...patch, version: this.snap.version + 1, updatedAt: new Date().toISOString() };
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ snap: this.snap, goId: this.goId, orderId: this.orderId }));
    } catch {
      /* ignore */
    }
    const s = this.snap;
    this.listeners.forEach((l) => l(s));
    return s;
  }
  private get st(): SessionState {
    return this.snap?.status ?? 'IDLE';
  }

  /* ---- boot */

  async config(): Promise<BoothConfig> {
    const [pkgs, frames, paymentConfig] = await Promise.all([
      go<GoPackage[]>('GET', '/api/package'),
      go<GoFrame[]>('GET', '/api/frames'),
      go<{ test_payment_enabled: boolean }>('GET', '/api/payment/config'),
    ]);
    const priced = pkgs.filter((p) => p.print_unit_price > 0);
    this.pkg = priced.find((p) => p.is_popular) ?? pkgs.find((p) => p.code === 'vip') ?? priced[0] ?? pkgs[0] ?? null;
    if (!this.pkg) throw new Error('Belum ada paket aktif di admin');
    this.packageDurationSecs = this.pkg.duration_secs || 600;
    const fromAdmin = (frames ?? []).map(frameToTemplate).filter((t) => t.photoCount > 0);
    this.templates = fromAdmin.length ? fromAdmin : DEFAULT_TEMPLATES;
    const d = DEFAULT_SETTINGS;
    const { digicamUrl: _a, gphoto2Bin: _b, captureCommand: _c, previewUrl: _d, ...camera } = d.camera;
    return {
      pricing: { ...d.pricing, firstPrint: this.pkg.price + this.pkg.print_unit_price, additionalPrint: this.pkg.print_unit_price },
      session: { ...d.session, shotsPerAngle: 1, retakeLimit: 2 },
      timeouts: d.timeouts,
      // Go returns the Canon live view already mirrored.
      camera: { ...camera, mirrorPreview: false, mode: 'server', liveViewUrl: '/api/robot/liveview' },
      templates: this.templates,
      angles: DEFAULT_ANGLES.map((a) => ({ id: a.id, name: a.name })),
      branding: d.branding,
      timingScale: 1,
      devTools: false,
      mockPayment: paymentConfig.test_payment_enabled,
      environment: 'production',
    };
  }

  async health() {
    let ok = false;
    try {
      ok = (await fetch('/health', { cache: 'no-store', signal: AbortSignal.timeout(5000) })).ok;
    } catch {
      /* down */
    }
    const server = { status: ok ? 'ok' : 'down', critical: true, message: ok ? 'Backend glambot aktif' : 'Backend glambot tidak terjangkau' };
    return { ok, acceptingSessions: ok, checkedAt: new Date().toISOString(), components: { server } } as Pick<HealthReport, 'ok' | 'acceptingSessions' | 'checkedAt'> & {
      components: Record<string, { status: string; critical: boolean; message: string }>;
    };
  }
  async active(): Promise<{ session: SessionSnapshot | null; token: string | null }> {
    return { session: this.snap, token: this.snap ? (this.token ?? 'local') : null };
  }
  async heartbeat(_body: unknown): Promise<{ ok: boolean; cameraFault: 'capture' | 'disconnect' | null }> {
    return { ok: true, cameraFault: null };
  }

  /* ---- session */

  async createSession(): Promise<SessionCreated> {
    this.clear();
    const now = new Date().toISOString();
    this.sessionId = `b-${newRequestId()}`;
    this.token = 'local';
    this.snap = {
      id: this.sessionId,
      code: '',
      status: 'SELECT_PRINT',
      quantity: 1,
      amount: 0,
      templateId: null,
      createdAt: now,
      paidAt: null,
      expiresAt: null,
      plan: { angles: 10, shotsPerAngle: 1, retakeLimit: 2, countdownSeconds: 3, readySeconds: DEFAULT_SETTINGS.session.readySeconds },
      payment: null,
      photos: [],
      slots: [],
      retakenAngles: [],
      capture: { angle: null, shot: null, retakeAngle: null },
      print: null,
      gallery: null,
      version: 0,
      updatedAt: now,
    };
    return { session: this.emit({}), token: this.token };
  }

  async getSession(id = this.sessionId): Promise<SessionSnapshot> {
    if (!this.snap || this.snap.id !== id) throw new ApiError(404, 'NOT_FOUND', 'Session not found');
    return this.snap;
  }

  /** Qty change / retry = new Go session (price is fixed at creation); the old one is expired. */
  async payment(quantity: number): Promise<SessionSnapshot> {
    if (!this.snap || !this.pkg) throw new ApiError(404, 'NOT_FOUND', 'Session not found');
    if (!UNPAID.includes(this.st)) invalid(this.st, 'payment');
    const seq = ++this.paySeq;
    this.stopPoll();
    this.expireGo();
    // Backend currently serves the create handler on /session/create; /session
    // returns 404 in the running API despite its route existing in source.
    const s = await go<GoSession>('POST', '/api/session/create', { packageId: this.pkg.id, printCount: quantity });
    const r = await go<{ transaction: GoTx; session: GoSession }>('POST', '/api/payment/create', { session_id: s.id }, undefined, 30000).catch((e) => {
      void go('PATCH', `/api/session/${s.id}/status`, { status: 'expired' }).catch(() => undefined);
      throw e;
    });
    if (seq !== this.paySeq || !this.snap) {
      void go('PATCH', `/api/session/${s.id}/status`, { status: 'expired' }).catch(() => undefined);
      return this.snap!;
    }
    if (!r.transaction?.midtrans_order_id || (!r.transaction.qris_raw_string && !r.transaction.qris_url && r.transaction.status !== 'paid')) {
      void go('PATCH', `/api/session/${s.id}/status`, { status: 'expired' }).catch(() => undefined);
      throw new ApiError(502, 'INVALID_PAYMENT_RESPONSE', 'Backend tidak mengembalikan ID transaksi atau QRIS yang valid.');
    }
    this.goId = s.id;
    this.orderId = r.transaction.midtrans_order_id;
    const paid = r.transaction.status === 'paid' || r.session.status === 'paid';
    const now = new Date().toISOString();
    const snap = this.emit({
      code: s.id.slice(0, 8).toUpperCase(),
      status: paid ? 'PAYMENT_SUCCESS' : 'WAITING_PAYMENT',
      quantity,
      amount: r.session.final_price,
      expiresAt: r.session.expires_at,
      paidAt: paid ? now : null,
      payment: {
        id: this.orderId,
        provider: 'midtrans',
        status: paid ? 'PAID' : 'PENDING',
        amount: r.session.final_price,
        quantity,
        qrString: r.transaction.qris_raw_string || r.transaction.qris_url || '',
        expiresAt: r.session.expires_at,
        paidAt: paid ? now : null,
      },
    });
    if (!paid) this.startPoll();
    return snap;
  }

  private startPoll() {
    this.stopPoll();
    this.poll = setInterval(() => void this.checkPayment(), 3000);
  }
  private stopPoll() {
    clearInterval(this.poll);
    this.poll = undefined;
  }
  private async checkPayment() {
    const orderId = this.orderId;
    if (!orderId || this.st !== 'WAITING_PAYMENT') return this.stopPoll();
    const pay = this.snap!.payment!;
    if (Date.parse(pay.expiresAt) < Date.now()) {
      this.stopPoll();
      this.emit({ status: 'PAYMENT_FAILED', payment: { ...pay, status: 'EXPIRED' } });
      return;
    }
    try {
      const r = await go<{ status: string; paid: boolean }>('GET', `/api/payment/status/${encodeURIComponent(orderId)}`);
      if (orderId !== this.orderId || this.st !== 'WAITING_PAYMENT') return;
      if (r.paid || r.status === 'paid') {
        this.stopPoll();
        const now = new Date().toISOString();
        this.emit({ status: 'PAYMENT_SUCCESS', paidAt: now, payment: { ...pay, status: 'PAID', paidAt: now } });
      } else if (PAID_FAIL.has(r.status)) {
        this.stopPoll();
        this.emit({ status: 'PAYMENT_FAILED', payment: { ...pay, status: r.status === 'expired' ? 'EXPIRED' : 'FAILED' } });
      }
    } catch (e) {
      // A 404 means transaction row is gone (usually stale QR after DB reset).
      // Stop polling; let customer create a fresh session/QR instead of waiting forever.
      if (e instanceof ApiError && e.status === 404 && orderId === this.orderId && this.st === 'WAITING_PAYMENT') {
        this.stopPoll();
        this.emit({ status: 'PAYMENT_FAILED', payment: { ...pay, status: 'EXPIRED' } });
      }
    }
  }

  private expireGo() {
    if (this.goId) void go('PATCH', `/api/session/${this.goId}/status`, { status: 'expired' }).catch(() => undefined);
    this.goId = null;
    this.orderId = null;
  }

  async mockPay(orderId: string): Promise<{ ok: boolean }> {
    if (!this.goId || !this.orderId || orderId !== this.orderId) throw new ApiError(404, 'NOT_FOUND', 'Transaksi testing tidak ditemukan');
    await go('POST', '/api/payment/test', { session_id: this.goId });
    await this.checkPayment();
    return { ok: true };
  }
  async uploadPhoto(..._args: unknown[]): Promise<SessionSnapshot> {
    throw new ApiError(400, 'UNSUPPORTED', 'Foto diambil oleh robot');
  }

  /* ---- robot (observed by flow.runCapture) */

  async robotDetection(): Promise<RobotDetection | null> {
    try {
      const r = await fetch(`${ROBOT_URL}/detection`, { cache: 'no-store', signal: AbortSignal.timeout(2000) });
      return r.ok ? ((await r.json()) as RobotDetection) : null;
    } catch {
      return null;
    }
  }
  async robotConfig(): Promise<RobotConfig | null> {
    return go<RobotConfig>('GET', '/api/robot/config', undefined, undefined, 3000).catch(() => null);
  }
  setPlanAngles(angles: number) {
    if (this.snap && this.snap.plan.angles !== angles) this.emit({ plan: { ...this.snap.plan, angles } });
  }
  /**
   * Pull the Go session photos. A new photo goes to `angle` (the pose the robot
   * is shooting), else the retake angle, else the first angle still empty.
   * A retake photo becomes the angle's pick; the old one stays, unselected.
   */
  async refreshPhotos(angle?: number): Promise<SessionSnapshot | null> {
    if (!this.goId || !this.snap) return this.snap;
    const list = await go<GoPhoto[]>('GET', `/api/photo/session/${this.goId}`, undefined, undefined, 5000).catch(() => null);
    if (!list || !this.snap) return this.snap;
    const s = this.snap;
    const known = new Set(s.photos.map((p) => p.id));
    const fresh = list.filter((p) => !known.has(p.id));
    if (!fresh.length) return s;
    const retakeAngle = s.status === 'RETAKE' ? s.capture.retakeAngle : null;
    let photos = [...s.photos];
    for (const p of fresh) {
      const used = new Set(photos.map((x) => x.angle));
      const a = retakeAngle ?? (angle !== undefined && !used.has(angle) ? angle : [...Array(s.plan.angles).keys()].find((i) => !used.has(i)) ?? photos.length);
      const retaken = retakeAngle !== null;
      if (retaken) photos = photos.map((x) => (x.angle === a ? { ...x, selected: false, superseded: true } : x));
      const url = p.url || `/storage/${p.file_path}`;
      const shot = photos.filter((x) => x.angle === a).length;
      photos.push({ id: p.id, angle: a, shot, selected: true, retaken, superseded: false, width: null, height: null, thumbUrl: url, previewUrl: url, createdAt: p.created_at });
    }
    return this.emit({ photos });
  }

  /* ---- commands */

  async command(cmd: SessionCommand, _opts: { requestId?: string; timeoutMs?: number; retries?: number } = {}): Promise<SessionSnapshot> {
    if (!this.snap) throw new ApiError(404, 'NOT_FOUND', 'Session not found');
    const st = this.st;
    const s = this.snap;
    switch (cmd.type) {
      case 'begin':
        // Paid: pick the frame first; its slot ratio drives the capture preview.
        if (st !== 'PAYMENT_SUCCESS') return st === 'FRAME_SELECTION' || st === 'READY' ? s : invalid(st, cmd.type);
        return this.emit({ status: 'FRAME_SELECTION' });
      case 'frame':
        if (st !== 'FRAME_SELECTION') return st === 'READY' ? s : invalid(st, cmd.type);
        if (this.goId) {
          const id = this.goId;
          // Same order as the glambot kiosk: session → shooting, then robot on.
          void go('PATCH', `/api/session/${id}/status`, { status: 'shooting' })
            .catch(() => undefined)
            .then(() => go('POST', '/api/robot/enable'))
            .catch(() => undefined);
        }
        return this.emit({ status: 'READY', templateId: cmd.templateId, slots: [] });
      case 'skip_angles':
        if (!CAPTURE_STATES.has(st)) return st === 'REVIEW' ? s : invalid(st, cmd.type);
        await go('POST', '/api/robot/disable').catch(() => undefined);
        await sleep(1500); // the shot in flight lands in storage
        await this.refreshPhotos();
        // All angles stay listed; the ones never shot show as empty in Review.
        return this.emit({ status: 'REVIEW', capture: { ...this.snap.capture, retakeAngle: null } });
      case 'move':
        if (st === 'READY') return this.emit({ status: 'ROBOT_MOVING', capture: { ...s.capture, angle: cmd.angle, shot: 0 } });
        return s;
      case 'countdown':
      case 'capture':
      case 'capture_failed':
      case 'next_shot':
      case 'angle_done':
      case 'resume':
      case 'prerender':
        return s;
      case 'retake': {
        if (st !== 'REVIEW' || !canRetake(s.retakenAngles, cmd.angle, s.plan.retakeLimit, s.plan.angles)) return invalid(st, cmd.type);
        // Robot shoots only this pose (1-based position in the dobot sequence).
        await this.enableRobot({ only: [cmd.angle + 1] });
        return this.emit({ status: 'RETAKE', retakenAngles: [...s.retakenAngles, cmd.angle], capture: { ...s.capture, angle: cmd.angle, retakeAngle: cmd.angle } });
      }
      case 'select_angle':
        return this.emit({ photos: s.photos.map((p) => (p.angle === cmd.angle ? { ...p, selected: cmd.photoIds.includes(p.id) } : p)) });
      case 'choose_frame':
        return st === 'REVIEW' ? this.emit({ status: 'PHOTO_SELECTION', slots: [] }) : invalid(st, cmd.type);
      case 'set_template':
        return this.emit({ templateId: cmd.templateId });
      case 'photos': {
        if (st !== 'PHOTO_SELECTION') invalid(st, cmd.type);
        const slots = cmd.photoIds.map((photoId, slotIndex) => ({ slotIndex, photoId, edit: s.slots.find((x) => x.photoId === photoId)?.edit ?? defaultEdit() }));
        return this.emit({ status: 'EDITING', slots });
      }
      case 'edits':
      case 'edit_done': {
        const slots = s.slots.map((x) => ({ ...x, edit: cmd.slots.find((y) => y.slotIndex === x.slotIndex)?.edit ?? x.edit }));
        if (cmd.type === 'edits') return this.emit({ slots });
        return st === 'EDITING' ? this.emit({ status: 'FINAL_PREVIEW', slots }) : invalid(st, cmd.type);
      }
      case 'back': {
        const to = BACK[st];
        return to ? this.emit({ status: to }) : invalid(st, cmd.type);
      }
      case 'confirm':
      case 'auto_complete': {
        const ok = cmd.type === 'confirm' ? st === 'FINAL_PREVIEW' : ['REVIEW', 'PHOTO_SELECTION', 'EDITING', 'FINAL_PREVIEW'].includes(st);
        if (!ok) invalid(st, cmd.type);
        const t = this.templateFor(s);
        let slots = s.slots;
        if (slots.length < t.photoCount) {
          const ids = autoPick(activePhotos(s.photos).map((p) => p.id), t.photoCount);
          slots = ids.map((photoId, slotIndex) => ({ slotIndex, photoId, edit: s.slots[slotIndex]?.edit ?? defaultEdit() }));
        }
        const snap = this.emit({ status: 'RENDERING', templateId: t.id, slots, print: { jobId: '', status: 'RENDERING', progress: 0, copies: s.quantity, error: null, userMessage: null } });
        void this.render(t);
        return snap;
      }
      case 'finish':
        if (st !== 'QR_READY') return invalid(st, cmd.type);
        localStorage.removeItem(STORE_KEY);
        return this.emit({ status: 'FINISHED' });
      case 'cancel':
        if (!UNPAID.includes(st)) return s;
        this.stopPoll();
        this.paySeq++;
        this.expireGo();
        return this.emit({ status: 'CANCELLED' });
      case 'retry_payment':
        return st === 'PAYMENT_FAILED' ? this.emit({ status: 'SELECT_PRINT', payment: null }) : invalid(st, cmd.type);
    }
  }

  /** Dobot answers 409 while the previous disable is still homing; retry until it is off. */
  private async enableRobot(body: { only: number[] }) {
    for (let i = 0; ; i++) {
      try {
        return await go('POST', '/api/robot/enable', body);
      } catch (e) {
        if (i >= 12) throw new ApiError(503, 'ROBOT_UNAVAILABLE', (e as Error).message, 'Robot belum siap. Coba lagi sebentar.');
        await sleep(1500);
      }
    }
  }

  private templateFor(s: SessionSnapshot): PhotoTemplate {
    const n = activePhotos(s.photos).length;
    return this.templates.find((t) => t.id === s.templateId) ?? this.templates.find((t) => t.photoCount <= n) ?? this.templates[0];
  }

  /** compose (canvas → Go) → print → QR to the Next.js download page. */
  private async render(t: PhotoTemplate) {
    const id = this.sessionId;
    const goId = this.goId;
    const alive = () => this.sessionId === id && !!this.snap;
    let links: Promise<{ url: string; preview?: string }> | null = null;
    try {
      if (!goId) throw new Error('Sesi glambot tidak ditemukan');
      const s = this.snap!;
      const slots = [...s.slots].sort((a, b) => a.slotIndex - b.slotIndex);
      const photos = slots.map((x) => s.photos.find((p) => p.id === x.photoId));
      const edits = Object.fromEntries(slots.map((x) => [x.slotIndex, x.edit]));
      const blob = await composeFrame(t, photos, edits);
      const form = new FormData();
      form.append('image', blob, 'strip.jpg');
      form.append('sessionId', goId);
      form.append('frameId', t.id);
      form.append('photoIds', JSON.stringify(slots.map((x) => x.photoId)));
      form.append('filter', slots[0]?.edit.filter ?? 'original');
      form.append('slotTransforms', JSON.stringify(slots.map((x) => ({ scale: x.edit.zoom, angle: x.edit.rotation, offsetX: x.edit.x, offsetY: x.edit.y }))));
      const composed = await go<{ preview_url?: string }>('POST', '/api/photo/compose', undefined, form, 60000);
      if (!alive()) return;
      // Resolved alongside printing so the QR screen usually opens without waiting.
      links = galleryLinks(goId, composed?.preview_url);
      this.emit({ status: 'PRINTING', print: { ...this.snap!.print!, status: 'PRINTING', progress: 30 } });
    } catch (e) {
      if (alive()) this.emit({ status: 'ERROR', print: { ...this.snap!.print!, status: 'FAILED', error: (e as Error).message, userMessage: 'Gagal menyimpan foto.' } });
      return;
    }
    try {
      await go('POST', '/api/photo/print', { session_id: goId }, undefined, 60000);
      if (!alive()) return;
      this.emit({ status: 'PRINT_SUCCESS', print: { ...this.snap!.print!, status: 'COMPLETED', progress: 100 } });
      await sleep(2500);
    } catch (e) {
      if (!alive()) return;
      const msg = (e as Error).message;
      this.emit({ status: 'PRINT_FAILED', print: { ...this.snap!.print!, status: 'FAILED', error: msg, userMessage: msg } });
    }
    const { url, preview } = await links!;
    if (alive()) this.emit({ status: 'QR_READY', gallery: { url, preview, expiresAt: new Date(Date.now() + 864e5).toISOString() } });
  }

  /** In-process "server push" (replaces the SSE stream). */
  subscribe(onSnapshot: (s: SessionSnapshot) => void): () => void {
    this.listeners.add(onSnapshot);
    return () => this.listeners.delete(onSnapshot);
  }

  clear() {
    if (this.snap && CAPTURE_STATES.has(this.snap.status)) void go('POST', '/api/robot/disable').catch(() => undefined);
    if (this.snap && UNPAID.includes(this.snap.status)) this.expireGo();
    this.stopPoll();
    this.paySeq++;
    this.token = null;
    this.sessionId = null;
    this.goId = null;
    this.orderId = null;
    this.snap = null;
    try {
      localStorage.removeItem(STORE_KEY);
    } catch {
      /* ignore */
    }
  }
}

export const api = new Api();
