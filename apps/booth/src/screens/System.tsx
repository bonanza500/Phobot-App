import { useEffect, useState } from 'react';
import { UNPAID_STATES } from '@photobooth/shared';
import { useBooth, set } from '../store';
import { Bubble, HaloRobot, Robot } from '../components/basics';
import { dev, resetToWelcome } from '../flow';
import { devMode } from '../kiosk';

/** Maintenance screen (critical hardware down) — same visual identity. */
export function Maintenance() {
  return (
    <div className="scr en booth-theme booth-center" style={{ alignItems: 'center', justifyContent: 'center', gap: 30, textAlign: 'center' }} data-testid="maintenance">
      <div className="free-spark free-spark-one" aria-hidden="true">✦</div>
      <div className="free-spark free-spark-two" aria-hidden="true">✧</div>
      <HaloRobot m="think" s={300} />
      <span className="free-eyebrow"><span>✦</span> PERAWATAN <span>✦</span></span>
      <h1 style={{ fontSize: 100 }}>Sebentar <em>ya!</em></h1>
      <p className="p" style={{ position: 'relative', fontSize: 44, lineHeight: 1.3 }}>
        Robot sedang bersiap-siap.
        <br />
        Booth akan kembali sebentar lagi.
      </p>
      <div className="chip" style={{ position: 'relative' }}>
        Hubungi petugas jika butuh bantuan
      </div>
      <footer className="free-footer"><span>ROBOT PHOTOBOOTH</span><i /> SEGERA KEMBALI</footer>
    </div>
  );
}

/** User-friendly error screen (never a stack trace). */
export function ErrorScreen() {
  const session = useBooth((s) => s.session);
  const clientError = useBooth((s) => s.clientError);
  const resetAfter = useBooth((s) => s.config?.timeouts.errorResetSeconds ?? 90);
  const [canReset, setCanReset] = useState(false);
  const unpaid = !session || UNPAID_STATES.has(session.status);
  useEffect(() => {
    const t = setTimeout(() => setCanReset(true), unpaid ? 0 : resetAfter * 1000);
    return () => clearTimeout(t);
  }, [unpaid, resetAfter]);
  return (
    <div className="scr en booth-theme booth-center" style={{ alignItems: 'center', justifyContent: 'center', gap: 30, textAlign: 'center' }} data-testid="error-screen">
      <HaloRobot m="think" s={300} />
      <span className="free-eyebrow"><span>✦</span> TENANG, FOTOMU AMAN <span>✦</span></span>
      <h2>Ada kendala <em>kecil</em></h2>
      <div style={{ width: 1100 }}>
        <Bubble small={session ? `Kode sesi: ${session.code} · fotomu tersimpan aman.` : undefined}>
          {clientError?.message ?? 'Petugas akan segera membantu. Mohon tunggu sebentar, ya.'}
        </Bubble>
      </div>
      {canReset ? (
        <button className="btn pr" style={{ marginTop: 20 }} onClick={resetToWelcome}>
          KEMBALI KE AWAL
        </button>
      ) : null}
      <footer className="free-footer"><span>ROBOT PHOTOBOOTH</span><i /> BANTUAN PETUGAS</footer>
    </div>
  );
}

export function ReconnectOverlay() {
  const online = useBooth((s) => s.online);
  if (online) return null;
  return (
    <div className="ovl" data-testid="reconnecting">
      <div className="card">
        <Robot m="think" s={220} />
        <h2>Sebentar ya…</h2>
        <p className="p">Sistem sedang menyambung ulang. Fotomu tetap aman.</p>
      </div>
    </div>
  );
}

export function Notice() {
  const notice = useBooth((s) => s.notice);
  if (!notice) return null;
  return (
    <div className="pill f" style={{ position: 'absolute', left: '50%', bottom: 40, transform: 'translateX(-50%)', zIndex: 15 }}>
      {notice}
    </div>
  );
}

/** Development toolbar — inspired by the prototype debug bar, never shown in production. */
export function DevBar() {
  const devTools = useBooth((s) => s.config?.devTools);
  const status = useBooth((s) => s.session?.status);
  const scale = useBooth((s) => s.config?.timingScale ?? 1);
  if (!devTools || !devMode()) return null;
  const fast = scale < 1;
  return (
    <div id="dm">
      Dev: {status ?? 'IDLE'}
      <button onClick={() => void dev.pay('PAID')}>✓ Bayar OK</button>
      <button onClick={() => void dev.pay('FAILED')}>✕ Gagal</button>
      <button className={fast ? 'on' : ''} onClick={() => set((s) => ({ config: s.config ? { ...s.config, timingScale: fast ? 1 : 0.1 } : s.config }))}>
        ⚡ Cepat
      </button>
      <button onClick={resetToWelcome}>⟲ Reset</button>
      <a href="/admin/" target="_blank" rel="noreferrer" style={{ color: '#fff' }}>
        Admin
      </a>
    </div>
  );
}
