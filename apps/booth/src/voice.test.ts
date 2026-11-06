import { expect, test } from 'vitest';

const played: string[] = [];
class FakeAudio {
  paused = false;
  private on: Record<string, () => void> = {};
  constructor(public src: string) {
    last = this;
  }
  addEventListener(e: string, f: () => void) {
    this.on[e] = f;
  }
  play() {
    played.push(this.src.split('/').pop()!);
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
  }
  end() {
    this.on.ended();
  }
  fail() {
    this.on.error();
  }
}
let last: FakeAudio;
(globalThis as any).Audio = FakeAudio;

test('new cue cuts the playing clip and drops the waiting ones; a list plays in order', async () => {
  const { voice } = await import('./voice');
  voice(['pay_qty', 'pay_show']);
  const a = last;
  voice('pick_add');
  const b = last;
  voice(['pose_x', 'tiga']);
  expect(a.paused).toBe(true);
  expect(b.paused).toBe(true);
  last.end();
  expect(played).toEqual(['pay_qty.mp3', 'pick_add.mp3', 'pose_x.mp3', 'tiga.mp3']);
  last.end();
});

test('screen change lets playing cue finish, replaces stale queue with latest screen cue', async () => {
  const { voice, voiceOnScreen } = await import('./voice');
  played.length = 0;
  voice(['pose_laugh', 'stale_next']);
  const current = last;
  voiceOnScreen(['qr_show']);
  expect(current.paused).toBe(false);
  expect(played).toEqual(['pose_laugh.mp3']);
  current.end();
  expect(played).toEqual(['pose_laugh.mp3', 'qr_show.mp3']);
  last.end();
});

test('hush cuts the playing clip and drops waiting copies', async () => {
  const { voice, hush } = await import('./voice');
  played.length = 0;
  voice(['welcome_idle', 'welcome_idle', 'pay_show']);
  const w = last;
  hush('welcome_idle');
  expect(w.paused).toBe(true);
  expect(played).toEqual(['welcome_idle.mp3', 'pay_show.mp3']);
  last.end();
});

test('`after` filler waits its turn and is skipped if `when` fails; missing clip moves on', async () => {
  const { voice } = await import('./voice');
  played.length = 0;
  let fits = true;
  voice('pose_laugh');
  const p = last;
  voice('hold_2', true, () => fits);
  voice('hold_1', true);
  expect(p.paused).toBe(false);
  fits = false;
  p.fail();
  expect(played).toEqual(['pose_laugh.mp3', 'hold_1.mp3']);
  last.end();
});

test('onEnd fires after the queued pose clip ends (or fails), not when cut', async () => {
  const { voice } = await import('./voice');
  played.length = 0;
  let ended = 0;
  voice('ready_next');
  const announce = last;
  voice(['pose_wave', 'hold_1'], true, undefined, () => ended++);
  expect(ended).toBe(0);
  announce.end();
  last.end();
  expect(ended).toBe(0);
  last.end();
  expect(played).toEqual(['ready_next.mp3', 'pose_wave.mp3', 'hold_1.mp3']);
  expect(ended).toBe(1);
  voice('pose_x', true, undefined, () => ended++);
  last.fail();
  expect(ended).toBe(2);
  voice('pose_y', true, undefined, () => ended++);
  voice('tiga');
  last.end();
  expect(ended).toBe(2);
});

test('admin upload plays first; a missing upload falls back to the built-in clip', async () => {
  const { voice, loadAudioUploads } = await import('./voice');
  (globalThis as any).fetch = async () => ({ ok: true, json: async () => ({ pay_ok: '7' }) });
  await loadAudioUploads();
  played.length = 0;
  voice('pay_ok');
  expect(last.src).toBe('/storage/audio/booth/pay_ok.mp3?v=7');
  last.fail();
  expect(last.src).toMatch(/\/audio\/pay_ok\.mp3$/);
  expect(last.src).not.toContain('storage');
  last.end();
  voice('pay_ok');
  expect(last.src).not.toContain('storage');
  last.end();
});

test('free payment flow does not announce QR scanning', async () => {
  const { paymentQrCue } = await import('./voice');
  expect(paymentQrCue(true)).toBeNull();
  expect(paymentQrCue(false)).toBe('pay_show');
});

test('digital-only session has no print completion cue', async () => {
  const { printDoneCue } = await import('./voice');
  expect(printDoneCue(0)).toBeNull();
  expect(printDoneCue(1)).toBe('print_done');
});

test('shutter cue waits for final countdown word', async () => {
  const { voice } = await import('./voice');
  played.length = 0;
  voice('satu');
  const countdown = last;
  voice('snap_wave', true);
  expect(countdown.paused).toBe(false);
  expect(played).toEqual(['satu.mp3']);
  countdown.end();
  expect(played).toEqual(['satu.mp3', 'snap_wave.mp3']);
  last.end();
});
