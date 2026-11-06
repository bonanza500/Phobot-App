/**
 * Robot voice clips (admin upload storage/audio/booth/<name>.mp3, else
 * public/audio/<name>.mp3), one channel. A new cue cuts
 * whatever is playing or waiting, so the voice always matches the screen.
 * Clips passed together play in order. `after` = filler: queue behind the
 * current clip instead of cutting it. `when` is checked as the cue's turn
 * comes; false = skip it (e.g. no time left).
 */
type Cue = { name: string; when?: () => boolean; onEnd?: () => void };
let cur: HTMLAudioElement | null = null;
let curName = '';
let queue: Cue[] = [];
/** id → version of clips uploaded in admin (storage/audio/booth); others use public/audio. */
let uploads: Record<string, string> = {};

/** Refresh the admin upload list; on failure keep the last one. */
export async function loadAudioUploads() {
  try {
    const r = await fetch('/api/audio', { cache: 'no-store' });
    if (r.ok) uploads = await r.json();
  } catch {
    /* offline: keep last list */
  }
}

export const audioUrl = (name: string) =>
  uploads[name] ? `/storage/audio/booth/${name}.mp3?v=${uploads[name]}` : `${import.meta.env.BASE_URL}audio/${name}.mp3`;

export const printDoneCue = (quantity: number) => quantity > 0 ? 'print_done' : null;
export const paymentQrCue = (freeMode: boolean) => freeMode ? null : 'pay_show';

function play(cue: Cue) {
  if (cue.when && !cue.when()) return next();
  const uploaded = !!uploads[cue.name];
  const a = new Audio(audioUrl(cue.name));
  cur = a;
  curName = cue.name;
  const done = () => {
    if (cur !== a) return;
    cue.onEnd?.();
    next();
  };
  a.addEventListener('ended', done);
  // Upload gone (detached since the last refresh): fall back to the built-in clip.
  a.addEventListener('error', () => {
    if (cur !== a || !uploaded) return done();
    delete uploads[cue.name];
    play(cue);
  });
  // Autoplay blocked: skip silently. Load errors are handled by the 'error' listener.
  a.play().catch((e: Error) => e.name === 'NotAllowedError' && done());
}

function next() {
  cur = null;
  const cue = queue.shift();
  if (cue) play(cue);
}

/** Clip length in seconds (0 if missing or slow to load). */
export function clipSeconds(name: string) {
  return new Promise<number>((done) => {
    const a = new Audio(audioUrl(name));
    a.preload = 'metadata';
    a.addEventListener('loadedmetadata', () => done(a.duration || 0), { once: true });
    a.addEventListener('error', () => done(0), { once: true });
    setTimeout(() => done(0), 1500);
  });
}

/** Stop a clip now (playing or waiting) without starting another, e.g. leaving the welcome page. */
export function hush(name: string) {
  queue = queue.filter((c) => c.name !== name);
  if (cur && curName === name) {
    cur.pause();
    next();
  }
}

/** `onEnd` fires once the last clip finished (or failed to play); not when another cue cuts it. */
export function voice(names: string | string[], after = false, when?: () => boolean, onEnd?: () => void) {
  const list: Cue[] = (typeof names === 'string' ? [names] : names).map((name) => ({ name, when }));
  if (onEnd && list.length) list[list.length - 1].onEnd = onEnd;
  if (after) queue.push(...list);
  else {
    cur?.pause();
    cur = null;
    queue = list;
  }
  if (!cur) next();
}

/** Replace waiting cues but let current clip finish before announcing new screen. */
export function voiceOnScreen(names: string | string[]) {
  queue = (typeof names === 'string' ? [names] : names).map((name) => ({ name }));
  if (!cur) next();
}
