import {
  applyEditOp,
  randomPick,
  CAPTURE_STATES,
  chooseForAngle,
  clampQuantity,
  defaultEdit,
  DEFAULT_TEMPLATE_ID,
  FILTERS,
  isTerminal,
  nextMissingStep,
  p2,
  sessionTip,
  togglePick as togglePickIds,
  type EditOp,
  type EditParams,
  type SessionCommand,
  type SessionSnapshot,
  type SessionState,
} from '@photobooth/shared';
import { api, ApiError, NetworkError, newRequestId, onConnectivity } from './api/client';
import { getCamera, cameraInstance } from './camera/service';
import { robot } from './robot/floating';
import { clipSeconds, loadAudioUploads, paymentQrCue, voice } from './voice';
import { canSwitchMode, freeModeOutdated, modeChanged, qtyAfterModeSwitch } from './payment-mode';
import { MAX_STICKERS, type Sticker } from './stickers';
import { currentScreen, currentTemplate, flatPhotos, get, plan, scaleMs, set, type BoothState } from './store';
import { timeoutAction } from './timeout-flow';

/** How often the booth checks whether admin switched between free and paid mode. */
export const MODE_POLL_MS = 3000;

/** How long the paid ticket stays up before the session begins. */
export const PAID_HOLD_MS = 4000;

/* ------------------------------------------------------------------ abort token (prototype `tok`) */

let tok = 0;
class Aborted extends Error {}
const wait = (ms: number, t: number) =>
  new Promise<void>((res, rej) => setTimeout(() => (t === tok ? res() : rej(new Aborted())), scaleMs(ms)));
const isAbort = (e: unknown) => e instanceof Aborted;

const SAVE_KEY = 'pb.session';
function saveSession() {
  try {
    if (api.sessionId && api.token) localStorage.setItem(SAVE_KEY, JSON.stringify({ id: api.sessionId, token: api.token }));
  } catch {
    /* ignore */
  }
}
function loadSaved(): { id: string; token: string } | null {
  try {
    return JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
  } catch {
    return null;
  }
}
function clearSaved() {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    /* ignore */
  }
}

let unsubscribe: (() => void) | null = null;
let captureRunning = false;
let beginScheduled = false;

/* ------------------------------------------------------------------ boot & recovery */

export async function boot() {
  const previewTab = new URLSearchParams(location.search).get('preview');
  let previewRows: { id: string; tab: string; script: string; tone: string; screenSeconds: number; uploaded: boolean; hasDefault: boolean }[] = [];
  if (previewTab) {
    try {
      previewRows = await (await fetch('/api/audio/scripts')).json();
    } catch {
      previewRows = [];
    }
  }
  void loadAudioUploads();
  for (let attempt = 0; ; attempt++) {
    try {
      const config = await api.config();
      set({ config, readyCd: config.session.readySeconds, bootError: null });
      break;
    } catch (e) {
      set({ bootError: (e as Error).message });
      await new Promise((r) => setTimeout(r, Math.min(10000, 1500 * (attempt + 1))));
    }
  }
  const config = get().config!;
  if (previewTab) {
    set({
      session: null,
      bootError: null,
      screenPreview: previewTab,
      previewRows,
      config: { ...config, pricing: { ...config.pricing, firstPrint: 1 } },
      booted: true,
    } as Partial<BoothState>);
    return;
  }
  const cam = getCamera(config.camera);
  cam.onStatus((st) => set({ cameraState: st.state, cameraError: st.lastError ?? null }));
  if (config.camera.mode === 'browser') void cam.start().catch(() => undefined);

  onConnectivity((online) => {
    set({ online });
    if (online) void resync();
  });

  await refreshHealth();
  await recover();
  set({ booted: true });

  setInterval(() => {
    const s = get();
    if (!s.session) void refreshHealth();
    const c = cameraInstance();
    if (c && c.mode === 'browser' && s.cameraState === 'error' && !s.session) void c.start().catch(() => undefined);
  }, 15000);
  setInterval(() => void heartbeat(), 10000);
  void heartbeat();
  setInterval(() => void syncMode(), MODE_POLL_MS);
}

export async function refreshHealth() {
  try {
    const h = await api.health();
    set({ health: { acceptingSessions: h.acceptingSessions, checkedAt: h.checkedAt, components: h.components } });
  } catch {
    /* keep last known */
  }
}

async function heartbeat() {
  const s = get();
  const cam = cameraInstance();
  try {
    const r = await api.heartbeat({
      camera: cam?.mode === 'browser' ? { state: s.cameraState, model: cam.status().model, error: s.cameraError ?? undefined } : undefined,
      screen: currentScreen(s),
      sessionId: s.session?.id ?? null,
    });
    cam?.setFault(r.cameraFault);
  } catch {
    /* offline */
  }
}

async function recover() {
  const saved = loadSaved();
  let snap: SessionSnapshot | null = null;
  if (saved) {
    api.sessionId = saved.id;
    api.token = saved.token;
    try {
      snap = await api.getSession();
    } catch {
      api.clear();
      clearSaved();
    }
  }
  if (!snap || isTerminal(snap.status)) {
    try {
      const r = await api.active();
      if (r.session && r.token) {
        api.sessionId = r.session.id;
        api.token = r.token;
        snap = r.session;
      }
    } catch {
      /* no recovery possible */
    }
  }
  if (snap && !isTerminal(snap.status) && snap.status !== 'FINISHED') {
    saveSession();
    subscribe();
    applySnapshot(snap, true);
  } else {
    api.clear();
    clearSaved();
  }
}

function subscribe() {
  unsubscribe?.();
  unsubscribe = api.subscribe((s) => applySnapshot(s));
}

export async function resync() {
  if (!api.sessionId) return;
  try {
    applySnapshot(await api.getSession());
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 401)) resetToWelcome();
  }
}

/* ------------------------------------------------------------------ snapshots */

export function applySnapshot(next: SessionSnapshot, recovering = false) {
  const s = get();
  const prev = s.session;
  if (!api.sessionId || next.id !== api.sessionId) return;
  if (prev && prev.id === next.id && next.version < prev.version) return; // stale
  const patch: Partial<BoothState> = { session: next };
  if (!prev || prev.status !== next.status || recovering) onEnterState(prev?.status ?? null, next, patch, recovering);
  set(patch);
}

function onEnterState(prevStatus: SessionState | null, next: SessionSnapshot, patch: Partial<BoothState>, recovering: boolean) {
  const s = get();
  switch (next.status) {
    case 'SELECT_PRINT':
    case 'WAITING_PAYMENT':
      if (recovering) patch.qty = next.quantity;
      break;
    case 'PAYMENT_SUCCESS':
      if (!beginScheduled) {
        beginScheduled = true;
        const t = tok;
        setTimeout(() => {
          beginScheduled = false;
          if (t === tok) beginAfterPayment();
        }, scaleMs(PAID_HOLD_MS));
      }
      break;
    case 'READY':
      void runSession(null);
      break;
    case 'RETAKE':
      void runSession(next.capture.retakeAngle ?? next.retakenAngles[next.retakenAngles.length - 1] ?? 0);
      break;
    case 'FRAME_SELECTION':
      patch.tplId = next.templateId ?? DEFAULT_TEMPLATE_ID;
      break;
    case 'PHOTO_SELECTION':
      if (prevStatus !== 'EDITING' || recovering) patch.picks = [...next.slots].sort((a, b) => a.slotIndex - b.slotIndex).map((x) => x.photoId);
      if (next.templateId) patch.tplId = next.templateId;
      break;
    case 'EDITING':
      if (prevStatus !== 'EDITING') {
        patch.edits = Object.fromEntries(next.slots.map((x) => [x.slotIndex, x.edit]));
        patch.picks = [...next.slots].sort((a, b) => a.slotIndex - b.slotIndex).map((x) => x.photoId);
        if (prevStatus !== 'FINAL_PREVIEW') patch.slot = 0;
        if (next.templateId) patch.tplId = next.templateId;
      }
      break;
    case 'FINAL_PREVIEW':
    case 'REVIEW':
      if (next.templateId) patch.tplId = next.templateId;
      if (next.status === 'FINAL_PREVIEW' && (recovering || prevStatus !== 'EDITING'))
        patch.edits = Object.fromEntries(next.slots.map((x) => [x.slotIndex, x.edit]));
      break;
    case 'PRINT_FAILED':
      patch.holdPrintUntil = Date.now() + 6500;
      break;
    case 'CANCELLED':
    case 'EXPIRED':
      setTimeout(resetToWelcome, 0);
      break;
    default:
      break;
  }
  // A restart in the middle of the capture phase: re-synchronise with the server.
  if (recovering && CAPTURE_STATES.has(next.status) && !['READY', 'RETAKE'].includes(next.status)) void sendResilient({ type: 'resume' });
  if (recovering && next.status === 'SESSION_COMPLETE') void sendResilient({ type: 'resume' });
  void s;
}

/* ------------------------------------------------------------------ commands */

export async function send(cmd: SessionCommand, opts: { timeoutMs?: number; requestId?: string; retries?: number } = {}): Promise<SessionSnapshot | null> {
  try {
    const snap = await api.command(cmd, opts);
    applySnapshot(snap);
    return snap;
  } catch (e) {
    if (e instanceof ApiError && e.code === 'INVALID_TRANSITION') {
      await resync();
      return null;
    }
    throw e;
  }
}

/** Keeps retrying through network outages (same request id → idempotent). */
async function sendResilient(cmd: SessionCommand, timeoutMs?: number): Promise<SessionSnapshot | null> {
  const requestId = newRequestId();
  const t = tok;
  for (let i = 0; ; i++) {
    try {
      return await send(cmd, { requestId, timeoutMs });
    } catch (e) {
      if (!(e instanceof NetworkError) || t !== tok) throw e;
      await new Promise((r) => setTimeout(r, Math.min(5000, 1000 + i * 500)));
    }
  }
}

/** Button actions: guard against double taps, surface friendly errors. */
async function guard(name: string, fn: () => Promise<unknown>) {
  if (get().busy) return;
  set({ busy: name });
  try {
    await fn();
  } catch (e) {
    if (isAbort(e)) return;
    const msg = (e as ApiError).userMessage ?? (e instanceof NetworkError ? e.userMessage : 'Terjadi kendala. Coba lagi, ya.');
    robot.say(msg, 2600);
    voice('err_general');
    set({ notice: msg });
    setTimeout(() => get().notice === msg && set({ notice: null }), 4000);
  } finally {
    set({ busy: null });
  }
}

/* ------------------------------------------------------------------ welcome & payment */

let payTimer: ReturnType<typeof setTimeout> | undefined;
/** payBusy stays on until the first request of a session, so it cannot tell whether one is running. */
let paymentRequests = 0;
let modeSyncing = false;

const mayPickUpMode = () => canSwitchMode(get().session?.status, paymentRequests > 0 || !!get().busy);

/** Apply a mode switch from admin as soon as the customer is somewhere it is safe to do so. */
export async function syncMode() {
  if (modeSyncing || !mayPickUpMode()) return;
  modeSyncing = true;
  try {
    const mode = await api.mode();
    if (!modeChanged(get().config, mode) || !mayPickUpMode()) return;
    const config = await api.config();
    // config() falls back to paid defaults if /api/config fails: never switch on that.
    if (modeChanged(config, mode) || !mayPickUpMode()) return;
    const s = get();
    set({ config: { ...config, timingScale: s.config?.timingScale ?? config.timingScale }, qty: qtyAfterModeSwitch(s.config, config, s.qty), payError: null });
  } catch {
    /* backend unreachable: the next tick tries again */
  } finally {
    modeSyncing = false;
  }
}

export async function startSession() {
  const s = get();
  if (s.entering || s.session) return;
  set({ entering: true, qty: s.config?.freeDigitalOnly ? 0 : 1, payError: null, payBusy: true });
  voice('welcome_start');
  // Admin may have swapped clips since boot; the rest of the session uses the new list.
  void loadAudioUploads();
  const t = tok;
  const anim = new Promise((r) => setTimeout(r, 1900));
  try {
    const r = await api.createSession();
    if (t !== tok) return;
    saveSession();
    subscribe();
    applySnapshot(r.session);
  } catch (e) {
    await anim;
    set({ entering: false, payBusy: false, session: null });
    api.clear();
    if (e instanceof ApiError && e.code === 'MAINTENANCE') await refreshHealth();
    else robot.say((e as ApiError).userMessage ?? 'Sistem sedang menyambung ulang…', 2500);
    return;
  }
  await anim;
  if (t === tok) set({ entering: false });
}

async function requestPayment(q: number) {
  paymentRequests++;
  set({ payBusy: true, payError: null });
  try {
    const st = get().session?.status;
    if (st === 'PAYMENT_FAILED') await send({ type: 'retry_payment' });
    const snap = await api.payment(q);
    if (freeModeOutdated(get().config, snap.status)) {
      applySnapshot(api.abandonPayment());
      set({ payBusy: false, payError: 'Pengaturan harga baru saja berubah. Coba lagi, ya.' });
      voice('pay_busy');
      // New config moves the customer off the free page when Free Mode really is off.
      void api
        .config()
        .then((config) => get().session && set({ config: { ...config, timingScale: get().config?.timingScale ?? config.timingScale } }))
        .catch(() => undefined);
      return;
    }
    applySnapshot(snap);
    if (get().qty === q) set({ payBusy: false });
  } catch (e) {
    if (e instanceof ApiError && e.code === 'INVALID_TRANSITION') {
      await resync();
      set({ payBusy: false });
      return;
    }
    set({ payBusy: false, payError: (e as ApiError).userMessage ?? 'Layanan pembayaran sedang sibuk. Coba lagi sebentar lagi.' });
    voice('pay_busy');
  } finally {
    paymentRequests--;
  }
}

/** prototype sq(): change quantity; a fresh dynamic QR is requested (debounced). */
export function setQty(delta: number) {
  const s = get();
  const max = s.config?.pricing.maxQuantity ?? 10;
  pickQty(clampQuantity(s.qty + delta, { ...s.config!.pricing, maxQuantity: max }));
}

/** qty 0 = digital only (no print). */
export const setDigital = (on: boolean) => {
  const wasDigital = get().qty === 0;
  pickQty(on ? 0 : 1);
  if (wasDigital !== on) voice(on ? 'pay_digital' : 'pay_print');
};

function pickQty(q: number) {
  const s = get();
  if (q === s.qty) return;
  set({ qty: q, payError: null, payBusy: true });
  clearTimeout(payTimer);
  if (s.session?.payment || s.session?.status === 'WAITING_PAYMENT') payTimer = setTimeout(() => void requestPayment(get().qty), 650);
}

export function selectQrPayment() {
  if (get().session?.status !== 'PAYMENT_SUCCESS') {
    const cue = paymentQrCue(get().config?.freeMode === true);
    if (cue) voice(cue);
    void requestPayment(get().qty);
  }
}

export const voucherAudioCue = (outcome: 'invalid' | 'partial' | 'free') =>
  ({ invalid: 'voucher_error', partial: 'voucher_partial', free: 'voucher_free' })[outcome];

export const announceVoucherEntry = () => voice('voucher_show');
export const announcePaymentMethods = () => voice('pay_method');

export function retryPayment() {
  void guard('retry-pay', () => requestPayment(get().qty));
}

/** User-facing voucher error: network vs server vs rejected code. */
export function voucherErrorMessage(e: unknown): string {
  if (e instanceof NetworkError) return 'Koneksi terputus. Periksa jaringan lalu coba lagi.';
  if (e instanceof ApiError) {
    if (e.status >= 500) return 'Server sedang bermasalah. Coba lagi sebentar.';
    return e.userMessage || e.message || 'Kode voucher tidak ditemukan.';
  }
  return 'Voucher gagal digunakan. Coba lagi.';
}

export async function applyFreeVoucher(code: string): Promise<string | null> {
  if (get().busy || get().session?.status === 'PAYMENT_SUCCESS') return 'Pembayaran sudah selesai.';
  set({ busy: 'voucher', payBusy: true, payError: null });
  try {
    const oldSession = get().session?.id;
    const snapshot = await api.applyFreeVoucher(code, get().qty);
    applySnapshot(snapshot);
    if (get().session?.status === 'WAITING_PAYMENT') {
      set({ payBusy: false });
      voice(voucherAudioCue('partial'));
    } else if (oldSession && get().session?.status === 'PAYMENT_SUCCESS') {
      voice(voucherAudioCue('free'));
    }
    return null;
  } catch (e) {
    voice(voucherAudioCue('invalid'));
    return voucherErrorMessage(e);
  } finally {
    set({ busy: null, payBusy: false });
  }
}

export async function simulateMockPayment() {
  const s = get().session;
  if (!get().config?.mockPayment || !s?.payment || s.payment.status !== 'PENDING' || get().payBusy) return;
  const orderId = s.payment.id;
  set({ payBusy: true, payError: null });
  try {
    await api.mockPay(orderId);
  } catch (e) {
    set({ payError: (e as ApiError).userMessage ?? 'Pembayaran demo gagal. Coba lagi.' });
  } finally {
    set({ payBusy: false });
  }
}

export function beginAfterPayment() {
  robot.flyRight(() => void sendResilient({ type: 'begin' }));
}

export function backFromPay() {
  void guard('cancel', async () => {
    clearTimeout(payTimer);
    try {
      await send({ type: 'cancel' }, { retries: 1 });
    } catch {
      /* the server reaper expires it anyway */
    }
    if (get().session && ['CANCELLED', 'EXPIRED'].includes(get().session!.status)) resetToWelcome();
    else if (!get().session || get().session!.status !== 'PAYMENT_SUCCESS') resetToWelcome();
  });
}

/* ------------------------------------------------------------------ capture (prototype ready() + run()) */

function setCapture(p: Partial<BoothState['capture']>) {
  set({ capture: { ...get().capture, ...p } });
}

/** Bubble after each shot; voice clip is `sess_nice_<index+1>` (≤2s, the bubble shows 2s). */
const NICE = [
  'Bagus banget!',
  'Keren abis!',
  'Nice!',
  'Mantul!',
  'Gaya kamu oke!',
  'Fotogenik banget!',
  'Posenya pas banget!',
  'Senyumnya juara!',
];

async function runSession(retakeAngle: number | null) {
  if (captureRunning) return;
  captureRunning = true;
  const t = tok;
  const cfg = get().config!;
  try {
    if (retakeAngle === null) {
      // READY: "Mulai dalam N detik"
      // Real seconds, as many as the countdown clip lasts; admin value only when the clip is missing.
      const clip = await clipSeconds('countdown');
      const total = clip > 0 ? Math.ceil(clip) : (get().session?.plan.readySeconds ?? cfg.session.readySeconds);
      set({ readyCd: total, readyTotal: total });
      for (let cd = total; cd > 0; cd--) {
        set({ readyCd: cd });
        await wait(1000, t);
      }
    }
    await runCapture(t, retakeAngle);
  } catch (e) {
    if (!isAbort(e)) {
      set({ notice: (e as ApiError).userMessage ?? 'Terjadi kendala.' });
      await resync();
    }
  } finally {
    captureRunning = false;
  }
}

/**
 * The Jona sequence runs on its own (enabled by `begin`): it moves through the
 * presets and the Go backend auto-captures at each one. The booth only observes
 * Flask /detection + Go /api/robot/config + the session photos and mirrors that
 * into the capture screen, then hands over to REVIEW when the sequence ends.
 */
async function runCapture(t: number, retakeAngle: number | null) {
  if (retakeAngle === null) await sendResilient({ type: 'move', angle: 0 }, 30000);
  const started = Date.now();
  // No on-screen timer: the session runs until all angles are shot. This cap only rescues a stuck robot.
  // A retake shoots one pose; cap it well below the full-session limit.
  const limitMs = retakeAngle === null ? api.captureLimitMs : 120000;
  let seenActive = false;
  const count0 = get().session?.photos.length ?? 0;
  let count = count0;
  let angle = retakeAngle ?? Math.min(count, plan(get()).angles - 1);
  let lastCd: number | null = null;
  setCapture({ angle, shot: 1, phase: 'move', message: '', cd: null, shotUrl: null });
  /** Local countdown anchored to backend shutter deadline, not poll arrival. */
  let shutterAt: number | null = null;
  let armedKey: number | null = null;
  let firedKey: number | null = null;
  /** When "Jepret!" showed; non-null until the photo arrives (or gives up). */
  let snapAt: number | null = null;
  /** Last "nice" line shown, so the next shot never repeats it. */
  let nice = -1;
  const ticker = setInterval(() => {
    if (shutterAt === null || t !== tok) return;
    const left = shutterAt - Date.now();
    if (left <= 0) {
      // Go fires the shutter now: "Jepret!", flash, freeze the live frame.
      firedKey = armedKey;
      shutterAt = null;
      lastCd = null;
      snapAt = Date.now();
      setCapture({ phase: 'cd', freeze: true });
      cd('snap');
      flash();
      const s = get().session;
      voice('snap_' + sessionTip(s?.id ?? '', angle, 0, s?.plan.shotsPerAngle ?? 2)[3], true);
      return;
    }
    const digit = left > 2000 ? 3 : left > 1000 ? 2 : 1;
    if (digit !== lastCd) {
      lastCd = digit;
      setCapture({ phase: 'cd' });
      cd(digit);
      voice(['satu', 'dua', 'tiga'][digit - 1], digit !== 3);
    }
  }, 50);
  try {
    for (;;) {
      await wait(250, t);
      const [det, rc] = await Promise.all([api.robotDetection(), api.robotConfig()]);
      const seq = det?.sequence;
      if (seq?.total) api.setPlanAngles(seq.total);
      const total = plan(get()).angles;
      // Robot still holds the pose until shortly after the shot, so its index tags the new photo.
      const robotAngle = seq?.index ? Math.max(0, Math.min(total - 1, seq.index - 1)) : undefined;
      const snap = await api.refreshPhotos(robotAngle);
      if (t !== tok) throw new Aborted();
      if (snap) applySnapshot(snap);
      const n = get().session?.photos.length ?? 0;
      const fsm = det?.fsm_state;
      if (fsm === 'MOVING' || fsm === 'TRACKING' || fsm === 'CAPTURING' || rc?.auto_capture_active) seenActive = true;
      angle = retakeAngle ?? robotAngle ?? Math.min(total - 1, n);

      if (n > count) {
        count = n;
        if (snapAt === null) flash();
        firedKey = armedKey;
        shutterAt = null;
        lastCd = null;
        const last = get().session!.photos.at(-1)!;
        const doneAngles = new Set(get().session!.photos.map((p) => p.angle)).size;
        const more = retakeAngle === null && doneAngles < total;
        if (more) nice = (nice + 1 + Math.floor(Math.random() * (NICE.length - 1))) % NICE.length;
        const msg = retakeAngle !== null ? 'Foto baru tersimpan!' : more ? NICE[nice] : 'Mantap! Semua angle selesai.';
        snapAt = null;
        // "Nice" shows at once over the frozen frame; the real photo swaps in once decoded (no blank gap).
        setCapture({ angle, phase: 'nice', cd: null, message: msg });
        voice(retakeAngle !== null ? 'sess_retake_ok' : more ? `sess_nice_${nice + 1}` : 'sess_done');
        await Promise.all([preload(last.previewUrl, 3000).then(() => t === tok && setCapture({ shotUrl: last.previewUrl, freeze: false })), wait(2000, t)]);
        if (t !== tok) throw new Aborted();
        setCapture({ shotUrl: null });
        continue;
      }
      // Shot failed or never arrived: unfreeze and fall back to live view.
      if (snapAt !== null && Date.now() - snapAt > 8000) {
        snapAt = null;
        setCapture({ freeze: false, cd: null });
      }

      const done =
        det?.session_stopped ||
        (seenActive && (seq?.complete || fsm === 'DONE')) ||
        (!det && (retakeAngle === null ? n >= total : n > count0)) ||
        Date.now() - started > limitMs;
      if (done) {
        await sendResilient({ type: 'skip_angles' }, 30000);
        return;
      }

      // 3-2-1 only from Go's timer. Go presses shutter as "1" appears; show 1
      // briefly, then indicate capture processing until the photo arrives.
      // Robot moves and the prep window show no digits. Deduplicate per pose.
      const key = seq?.index ?? -(n + 1);
      const leftMs = rc?.auto_capture_active ? rc.auto_capture_remaining_ms : 0;
      if (key !== firedKey && leftMs > 0 && (shutterAt === null || key !== armedKey)) {
        armedKey = key;
        shutterAt = Date.now() + leftMs;
        lastCd = null;
      }
      if (shutterAt === null && snapAt === null) {
        const prepEnd = fsm === 'TRACKING' && seq ? Date.now() + seq.seconds_left * 1000 : 0;
        setCapture({ angle, phase: fsm === 'TRACKING' || fsm === 'CAPTURING' || rc?.auto_capture_active ? 'prep' : 'move', cd: null, prepEnd });
      }
    }
  } finally {
    clearInterval(ticker);
    setCapture({ freeze: false });
  }
}

/** Resolves once the image is decoded (or failed / timed out). */
function preload(url: string, ms: number) {
  return new Promise<void>((res) => {
    const img = new Image();
    img.onload = img.onerror = () => res();
    setTimeout(res, ms);
    img.src = url;
  });
}

function cd(v: number | 'cam' | 'snap') {
  const c = get().capture as BoothState['capture'] & { cd?: number | 'cam' | 'snap'; cdKey?: number };
  set({ capture: { ...c, cd: v, cdKey: (c.cdKey ?? 0) + 1 } as BoothState['capture'] });
}
function flash() {
  const c = get().capture as BoothState['capture'] & { flashKey?: number };
  set({ capture: { ...c, flashKey: (c.flashKey ?? 0) + 1 } as BoothState['capture'] });
}

/* ------------------------------------------------------------------ review */

export function tapReviewPhoto(angle: number, id: string) {
  const s = get();
  const sess = s.session!;
  const ps = sess.photos.filter((x) => x.angle === angle);
  if (ps.length <= sess.plan.shotsPerAngle) {
    set({ big: id });
    return;
  }
  const sel = ps.filter((x) => x.selected).sort((a, b) => a.shot - b.shot).map((x) => x.id);
  if (sel.includes(id)) return;
  const next = chooseForAngle(sel, id, sess.plan.shotsPerAngle);
  // optimistic: reflect immediately, the server confirms
  set({ session: { ...sess, photos: sess.photos.map((x) => (x.angle === angle ? { ...x, selected: next.includes(x.id), superseded: !next.includes(x.id) } : x)) } });
  void send({ type: 'select_angle', angle, photoIds: next }).catch(() => resync());
  robot.react('thumbs', 'wob', 'Pilihan bagus!', null, 1.2);
  voice('pick_add');
}

export function retake(angle: number) {
  voice('review_retake');
  robot.rbNav(`Ulang angle ${p2(angle + 1)}`, 'cam', () => void guard('retake', () => send({ type: 'retake', angle })));
}

/** "Selesai": end the robot sequence early once the frame's slots can be filled. */
export function skipSession() {
  captureRunning = false;
  tok++;
  voice('sess_skip');
  robot.rbNav('Selesai!', 'cheer', () => {
    if (get().busy) return;
    void send({ type: 'skip_angles' });
  });
}

export function toFrames() {
  voice('review_ok');
  robot.rbNav('Pilih fotonya, yuk!', 'point', () => void guard('frames', () => send({ type: 'choose_frame' })));
}

export function back() {
  void guard('back', async () => {
    if (get().session?.status === 'EDITING') await flushEdits();
    await send({ type: 'back' });
  });
}

/* ------------------------------------------------------------------ frame */

export function chooseTemplate(id: string) {
  const s = get();
  const t = s.config?.templates.find((x) => x.id === id);
  if (!t) return;
  set({ tplId: id, picks: [], edits: {}, stickers: [] });
  void send({ type: 'set_template', templateId: id }).catch(() => undefined);
  const r = t.reaction;
  if (r) robot.react(r.pose, r.anim, r.text, r.fx, 1.7);
}

export function confirmTemplate() {
  robot.rbNav('Siap foto!', 'cam', () => void guard('frame', () => send({ type: 'frame', templateId: currentTemplate(get()).id })));
}

/* ------------------------------------------------------------------ pick (prototype fpk / autoFp) */

export function togglePick(id: string) {
  const s = get();
  const n = currentTemplate(s).photoCount;
  const { picks, added } = togglePickIds(s.picks, id, n);
  set({ picks });
  const angle = (s.session?.photos.find((x) => x.id === id)?.angle ?? 0) + 1;
  if (!added) robot.react('think', null, 'Batal? Oke', '', 1.2);
  else if (picks.length == n) robot.react('cheer', 'hop', 'Lengkap! Lanjut, yuk', 'star', 1.8);
  else robot.react('thumbs', 'wob', 'Angle ' + angle + ', bagus!', '', 1.2);
  voice(!added ? 'pick_remove' : picks.length == n ? 'pick_full' : 'pick_add');
}

export function autoPick() {
  const s = get();
  set({ picks: randomPick(flatPhotos(s), currentTemplate(s).photoCount) });
  robot.react('free', 'dance', 'Dipilihkan!', 'star', 1.6);
  voice('pick_auto');
}

export function clearPicks() {
  set({ picks: [] });
  robot.react('shock', 'shake', 'Kosong lagi!', null, 1.2);
  voice('pick_clear');
}

export function confirmPicks() {
  const s = get();
  if (s.picks.length !== currentTemplate(s).photoCount) return;
  voice('pick_ok');
  robot.rbNav('Saatnya edit!', 'point', () => void guard('photos', () => send({ type: 'photos', photoIds: get().picks })));
}

/* ------------------------------------------------------------------ edit (prototype ed() + gestures) */

let editTimer: ReturnType<typeof setTimeout> | undefined;

export function editOf(slot: number): EditParams {
  return get().edits[slot] ?? defaultEdit();
}

export function selectSlot(i: number) {
  if (get().slot !== i) robot.say('Foto ' + (i + 1) + ' dipilih', 1100);
  set({ slot: i });
}

export function setEdit(slot: number, e: EditParams) {
  set({ edits: { ...get().edits, [slot]: e } });
  clearTimeout(editTimer);
  editTimer = setTimeout(() => void flushEdits(), 1200);
}

async function flushEdits() {
  clearTimeout(editTimer);
  const s = get();
  if (s.session?.status !== 'EDITING') return;
  const slots = Object.entries(s.edits).map(([k, edit]) => ({ slotIndex: Number(k), edit }));
  if (slots.length) await api.command({ type: 'edits', slots }, { retries: 2 }).catch(() => undefined);
}

export function addSticker(k: string) {
  const list = get().stickers;
  if (list.length >= MAX_STICKERS) {
    robot.say('Stikernya sudah penuh', 1400);
    return null;
  }
  const o = ((list.length % 5) - 2) * 0.06;
  const st: Sticker = { id: Date.now(), k, x: 0.5 + o, y: 0.45 + o, s: 0.24 };
  set({ stickers: [...list, st] });
  robot.react('cheer', 'hop', 'Lucu!', null, 1.1);
  return st.id;
}

export function updateSticker(id: number, p: Partial<Sticker>) {
  set({ stickers: get().stickers.map((s) => (s.id === id ? { ...s, ...p } : s)) });
}

export function removeSticker(id: number) {
  set({ stickers: get().stickers.filter((s) => s.id !== id) });
}

export function editOp(op: EditOp) {
  const s = get();
  const e = applyEditOp(editOf(s.slot), op);
  setEdit(s.slot, e);
  const rx: Partial<Record<EditOp['op'], [string, string, string]>> = {
    rotate90: ['cool', 'spin', 'Muter!'],
    flip: ['peace', 'wob', 'Dibalik!'],
    brightness: op.op === 'brightness' && op.delta > 0 ? ['cheer', 'hop', 'Terang!'] : ['think', 'wob', 'Redup...'],
    filter: ['heart', 'wob', op.op === 'filter' ? (FILTERS.find((f) => f.id === op.filter)?.reaction ?? 'Natural!') : ''],
    crop: ['thumbs', 'wob', 'Dipotong!'],
    reset: ['shock', 'shake', 'Reset!'],
  };
  const r = rx[op.op];
  if (r) robot.react(r[0], r[1], r[2], op.op === 'filter' ? 'heart' : null, 1.3);
  // ponytail: no clips yet for brightness (edit_bright_up/down); add them to public/audio then map here.
  if (op.op !== 'brightness') voice(op.op === 'filter' ? 'flt_' + op.filter : op.op === 'rotate90' ? 'edit_rotate' : 'edit_' + op.op);
}

export function editDone() {
  voice('edit_ok');
  robot.rbNav('Hampir selesai!', 'cheer', () =>
    void guard('edit_done', async () => {
      clearTimeout(editTimer);
      const slots = Object.entries(get().edits).map(([k, edit]) => ({ slotIndex: Number(k), edit }));
      await send({ type: 'edit_done', slots });
    }),
  );
}

/* ------------------------------------------------------------------ final / print / qr / thanks */

export function confirmPrint() {
  voice('final_ok');
  robot.rbNav(get().session?.quantity ? 'Siap cetak!' : 'Siap simpan!', 'cheer', () => void guard('confirm', () => send({ type: 'confirm' })));
}

export function finish() {
  void guard('finish', () => send({ type: 'finish' }));
}

/** Timeout handling per screen (unpaid → cancel, paid → auto-complete, done → finish). */
export function onIdleTimeout() {
  const s = get();
  if (s.screenPreview) return;
  const st = s.session?.status;
  if (!st) return;
  if (st === 'SELECT_PRINT' || st === 'WAITING_PAYMENT' || st === 'PAYMENT_FAILED') return backFromPay();
  switch (timeoutAction(st)) {
    case 'choose-frame': return toFrames();
    case 'confirm-frame': return confirmTemplate();
    case 'auto-pick':
      autoPick();
      return confirmPicks();
    case 'finish-edit': return editDone();
    case 'confirm-output': return void guard('auto', () => send({ type: 'confirm' }));
    case 'auto-complete':
      return void guard('auto', async () => {
        await flushEdits();
        await send({ type: 'auto_complete' });
      });
  }
  if (st === 'QR_READY') return finish();
  if (st === 'FINISHED' || st === 'ERROR') return resetToWelcome();
}

/** prototype init(); go('welcome') */
export function resetToWelcome() {
  tok++;
  captureRunning = false;
  beginScheduled = false;
  clearTimeout(payTimer);
  clearTimeout(editTimer);
  unsubscribe?.();
  unsubscribe = null;
  api.clear();
  clearSaved();
  set({
    session: null,
    entering: false,
    holdPrintUntil: 0,
    qty: 1,
    payBusy: false,
    payError: null,
    tplId: DEFAULT_TEMPLATE_ID,
    picks: [],
    edits: {},
    stickers: [],
    slot: 0,
    capture: { angle: 0, shot: 0, phase: '', message: '' },
    big: null,
    busy: null,
    notice: null,
    clientError: null,
    timer: null,
    readyCd: get().config?.session.readySeconds ?? 5,
  });
  void refreshHealth();
  // Pick up admin changes (free mode, prices, voucher chip) for the next session.
  void api
    .config()
    .then((config) => !get().session && set({ config: { ...config, timingScale: get().config?.timingScale ?? config.timingScale } }))
    .catch(() => undefined);
}

export function closeLightbox() {
  set({ big: null });
}

/* Dev helpers (only reachable from the ?dev toolbar in non-production builds). */
export const dev = {
  async pay(status: 'PAID' | 'FAILED') {
    const s = get().session;
    if (!s?.payment) return;
    await fetch(`/mock-pay/${encodeURIComponent(s.payment.qrString.split('/mock-pay/')[1] ?? '')}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status }),
    }).catch(() => undefined);
  },
};
