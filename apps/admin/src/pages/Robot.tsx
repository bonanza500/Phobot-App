import { useEffect, useRef, useState } from 'react';
import { del, get, post, put } from '../api';
import { toast, usePoll } from '../ui';

// Talks to jona-bridge through the /jona proxy. The bridge holds the serial port, so the
// booth and this page never fight over it; it refuses manual moves while a photo session runs.
const J = '/jona/admin';

interface Pose {
  id: number;
  name: string;
  position: { joints?: number[] };
  settleMs?: number;
}
interface State {
  port: string;
  mock: boolean;
  connected: boolean;
  session: boolean;
  busy: boolean;
  action: string | null;
  error: string | null;
  joints: { deg: number[]; moving: boolean; jogging: number | null } | null;
  spec: { joint: number; min: number; max: number; degPerSec: number }[];
  presets: Pose[];
}

const STEPS = [0.1, 1, 5, 10];
const HOLD_MS = 300; // pressed longer than this = continuous jog
const BEAT_MS = 150; // bridge stops the jog after 500 ms without a beat
const fmt = (v: number) => (Math.round(v * 100) / 100).toFixed(2);

export function Robot() {
  const [s, reload, err] = usePoll<State>(() => get(`${J}/state`), 700);
  const [speed, setSpeed] = useState(30);
  const [step, setStep] = useState(1);

  const act = async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      await fn();
      if (ok) toast(ok);
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      await reload();
    }
  };

  if (!s) return <div className="grid">{err ? <BridgeDown err={err} /> : <p className="mu">Menghubungi robot…</p>}</div>;

  const deg = s.joints?.deg ?? s.spec.map(() => 0);
  const locked = !s.connected || s.session || s.busy;
  const moveTo = (joints: number[]) => act(() => post(`${J}/move`, { joints }));

  return (
    <div className="grid">
      <div className="row">
        <h1 style={{ margin: 0 }}>Robot</h1>
        <span className="spacer" />
        <button className="btn er" style={{ fontWeight: 700, minWidth: 140 }} onClick={() => void act(() => post(`${J}/stop`), 'Robot dihentikan')}>
          ■ STOP
        </button>
      </div>

      <div className="card row" style={{ flexWrap: 'wrap', gap: 10 }}>
        <span className={`chip ${s.mock ? 'warn' : s.connected ? 'ok' : 'err'}`}>{s.mock ? 'Simulasi' : s.connected ? 'Tersambung' : 'Terputus'}</span>
        <span className="small mu">Port {s.port}</span>
        {s.session ? <span className="chip warn">Sesi foto berjalan — kontrol manual dikunci</span> : null}
        {s.action ? <span className="chip warn">Robot {s.action}…</span> : s.joints?.moving ? <span className="chip warn">Bergerak…</span> : null}
        {s.error ? <span className="chip err">{s.error}</span> : null}
        {err ? <span className="chip err">{err}</span> : null}
        <span className="spacer" />
        {!s.connected ? (
          <button className="btn pr" onClick={() => void act(() => post(`${J}/connect`), 'Robot tersambung')}>
            Sambungkan
          </button>
        ) : null}
        <button className="btn" disabled={locked} onClick={() => confirm('Gerakkan semua joint ke 0° (home)?') && void act(() => post(`${J}/home`))}>
          Home
        </button>
      </div>

      <div className="card">
        <div className="row" style={{ flexWrap: 'wrap', gap: 16 }}>
          <h2 style={{ margin: 0 }}>Gerak manual</h2>
          <span className="spacer" />
          <label className="small row" style={{ gap: 8 }}>
            Kecepatan tahan
            <input type="range" min={5} max={100} step={5} value={speed} onChange={(e) => setSpeed(Number(e.target.value))} />
            <b style={{ width: 40 }}>{speed}%</b>
          </label>
          <span className="small row" style={{ gap: 6 }}>
            Langkah
            {STEPS.map((v) => (
              <button key={v} className={`btn ${step === v ? 'pr' : ''}`} style={{ padding: '6px 10px' }} onClick={() => setStep(v)}>
                {v}°
              </button>
            ))}
          </span>
        </div>
        <p className="mu small">
          Klik − / + untuk bergerak {step}°. Tahan tombolnya untuk bergerak terus dengan kecepatan {speed}%, lepas untuk berhenti. Geser slider atau ketik sudut lalu Enter untuk langsung ke sudut itu.
        </p>
        <div className="grid" style={{ gap: 10 }}>
          {s.spec.map((j) => (
            <JointRow
              key={j.joint}
              spec={j}
              value={deg[j.joint]}
              locked={locked}
              jogging={s.joints?.jogging === j.joint}
              onStep={(dir) => {
                const t = Math.min(j.max, Math.max(j.min, Math.round((deg[j.joint] + dir * step) * 100) / 100));
                void moveTo(deg.map((v, i) => (i === j.joint ? t : v)));
              }}
              onGoto={(t) => void moveTo(deg.map((v, i) => (i === j.joint ? t : v)))}
              onJogStart={(dir) => post(`${J}/jog/start`, { joint: j.joint, dir, speed })}
              onJogStop={() => act(() => post(`${J}/jog/stop`))}
            />
          ))}
        </div>
      </div>

      <Presets s={s} deg={deg} locked={locked} act={act} />
    </div>
  );
}

function BridgeDown({ err }: { err: string }) {
  return (
    <div className="card">
      <h1>Robot</h1>
      <div className="chip err">{err}</div>
      <p className="mu">
        Halaman ini butuh <b>jona-bridge</b> (port 5001) yang memegang port serial robot. Jalankan <span className="mono">npm run start:jona</span> dari folder Phobot App.
      </p>
    </div>
  );
}

function JointRow(p: {
  spec: State['spec'][number];
  value: number;
  locked: boolean;
  jogging: boolean;
  onStep: (dir: 1 | -1) => void;
  onGoto: (deg: number) => void;
  onJogStart: (dir: 1 | -1) => Promise<unknown>;
  onJogStop: () => Promise<unknown>;
}) {
  const { spec, value } = p;
  const [slider, setSlider] = useState<number | null>(null);
  const [text, setText] = useState<string | null>(null);

  return (
    <div className="row" style={{ gap: 12, flexWrap: 'wrap', padding: '8px 0', borderTop: '1px solid var(--line)' }}>
      <b style={{ width: 34 }}>J{spec.joint + 1}</b>
      <HoldButton label="−" dir={-1} {...p} />
      <input
        type="range"
        min={spec.min}
        max={spec.max}
        step={0.5}
        disabled={p.locked}
        value={slider ?? value}
        onChange={(e) => setSlider(Number(e.target.value))}
        onPointerUp={() => {
          if (slider !== null && slider !== value) p.onGoto(slider);
          setSlider(null);
        }}
        onKeyUp={(e) => {
          if (slider !== null && (e.key.startsWith('Arrow') || e.key === 'Home' || e.key === 'End')) {
            p.onGoto(slider);
            setSlider(null);
          }
        }}
        style={{ flex: '1 1 220px' }}
        aria-label={`Sudut J${spec.joint + 1}`}
      />
      <HoldButton label="+" dir={1} {...p} />
      <input
        className="mono"
        style={{ width: 90, textAlign: 'right' }}
        disabled={p.locked}
        value={text ?? fmt(slider ?? value)}
        onFocus={() => setText(fmt(value))}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => setText(null)}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return;
          const n = Number(text);
          if (!Number.isFinite(n) || n < spec.min || n > spec.max) return toast(`J${spec.joint + 1} harus antara ${spec.min}° dan ${spec.max}°`, true);
          p.onGoto(n);
          (e.target as HTMLInputElement).blur();
        }}
        aria-label={`Ketik sudut J${spec.joint + 1}`}
      />
      <span className="small mu" style={{ width: 150 }}>
        {spec.min}° … {spec.max}° · {spec.degPerSec}°/s
      </span>
      {p.jogging ? <span className="chip warn">jog</span> : null}
    </div>
  );
}

/** Click = one step. Hold = jog until released (with a heartbeat so a lost tab stops the arm). */
function HoldButton(p: { label: string; dir: 1 | -1; locked: boolean; onStep: (dir: 1 | -1) => void; onJogStart: (dir: 1 | -1) => Promise<unknown>; onJogStop: () => Promise<unknown> } & { spec: State['spec'][number] }) {
  const hold = useRef<{ timer?: number; beat?: number; jogging: boolean } | null>(null);
  const stepRef = useRef(p.onStep);
  stepRef.current = p.onStep;

  const end = (cancelled: boolean) => {
    const h = hold.current;
    if (!h) return;
    hold.current = null;
    clearTimeout(h.timer);
    clearInterval(h.beat);
    if (h.jogging) void p.onJogStop();
    else if (!cancelled) stepRef.current(p.dir);
  };
  useEffect(() => () => end(true), []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <button
      className="btn"
      style={{ width: 46, fontSize: 20, fontWeight: 700, touchAction: 'none', userSelect: 'none' }}
      disabled={p.locked && !hold.current}
      onPointerDown={(e) => {
        if (p.locked || e.button !== 0) return;
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        const h: { timer?: number; beat?: number; jogging: boolean } = { jogging: false };
        hold.current = h;
        h.timer = window.setTimeout(async () => {
          h.jogging = true;
          try {
            await p.onJogStart(p.dir);
            h.beat = window.setInterval(() => void post(`${J}/jog/beat`).catch(() => undefined), BEAT_MS);
            if (hold.current !== h) void p.onJogStop(); // released while the start was on its way
          } catch (err) {
            h.jogging = false;
            toast((err as Error).message, true);
          }
        }, HOLD_MS);
      }}
      onPointerUp={() => end(false)}
      onPointerCancel={() => end(true)}
      aria-label={`${p.dir > 0 ? 'Tambah' : 'Kurangi'} J${p.spec.joint + 1}`}
    >
      {p.label}
    </button>
  );
}

function Presets({ s, deg, locked, act }: { s: State; deg: number[]; locked: boolean; act: (fn: () => Promise<unknown>, ok?: string) => Promise<void> }) {
  const [name, setName] = useState('');
  const [names, setNames] = useState<Record<number, string>>({});
  const editLocked = s.session;
  const order = (ids: number[]) => act(() => post(`${J}/presets/order`, { ids }), 'Urutan disimpan');
  const move = (i: number, d: number) => {
    const ids = s.presets.map((a) => a.id);
    [ids[i], ids[i + d]] = [ids[i + d], ids[i]];
    void order(ids);
  };

  return (
    <div className="card">
      <h2>Pose foto</h2>
      <p className="mu small">
        Urutan di tabel = urutan robot saat sesi foto. Perubahan langsung tersimpan ke <span className="mono">config/angles.json</span> dan dipakai sesi berikutnya, tanpa restart.
      </p>
      <div className="row" style={{ gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        <input placeholder={`Nama (kosong = P${s.presets.length + 1})`} value={name} maxLength={40} onChange={(e) => setName(e.target.value)} style={{ flex: '0 1 260px' }} />
        <button
          className="btn pr"
          disabled={locked}
          onClick={() =>
            confirm(`Simpan pose sekarang (${deg.map(fmt).join(', ')}) sebagai pose baru?`) &&
            void act(async () => {
              await post(`${J}/presets`, { name });
              setName('');
            }, 'Pose disimpan')
          }
        >
          Simpan pose sekarang
        </button>
      </div>
      <div className="tbl">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Nama</th>
              {s.spec.map((j) => (
                <th key={j.joint} style={{ textAlign: 'right' }}>
                  J{j.joint + 1}
                </th>
              ))}
              <th />
            </tr>
          </thead>
          <tbody>
            {s.presets.map((a, i) => {
              const nm = names[a.id] ?? a.name;
              const joints = a.position.joints ?? [];
              return (
                <tr key={a.id}>
                  <td>{a.id}</td>
                  <td>
                    <input
                      value={nm}
                      maxLength={40}
                      disabled={editLocked}
                      style={{ width: 120 }}
                      onChange={(e) => setNames((o) => ({ ...o, [a.id]: e.target.value }))}
                      onBlur={() => {
                        if (nm.trim() && nm !== a.name) void act(() => put(`${J}/presets/${a.id}`, { name: nm }), 'Nama disimpan');
                        setNames(({ [a.id]: _, ...o }) => o);
                      }}
                      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                    />
                  </td>
                  {s.spec.map((j) => (
                    <td key={j.joint} className="mono" style={{ textAlign: 'right' }}>
                      {joints[j.joint] !== undefined ? fmt(joints[j.joint]) : '—'}
                    </td>
                  ))}
                  <td>
                    <div className="btns" style={{ flexWrap: 'nowrap' }}>
                      <button className="btn pr" disabled={locked} onClick={() => void act(() => post(`${J}/presets/${a.id}/goto`))}>
                        Pergi
                      </button>
                      <button
                        className="btn"
                        disabled={locked}
                        title="Ganti sudut pose ini dengan posisi robot sekarang"
                        onClick={() => confirm(`Timpa ${a.name} dengan pose sekarang (${deg.map(fmt).join(', ')})?`) && void act(() => put(`${J}/presets/${a.id}`, { joints: 'current' }), `${a.name} diperbarui`)}
                      >
                        Timpa
                      </button>
                      <button className="btn" disabled={editLocked || i === 0} onClick={() => move(i, -1)} aria-label={`Naikkan ${a.name}`}>
                        ↑
                      </button>
                      <button className="btn" disabled={editLocked || i === s.presets.length - 1} onClick={() => move(i, 1)} aria-label={`Turunkan ${a.name}`}>
                        ↓
                      </button>
                      <button className="btn er" disabled={editLocked || s.presets.length <= 1} onClick={() => confirm(`Hapus ${a.name}?`) && void act(() => del(`${J}/presets/${a.id}`), `${a.name} dihapus`)}>
                        Hapus
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
