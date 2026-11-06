import { useEffect, useState } from 'react';
import { rp } from '@photobooth/shared';
import { currentTemplate, useBooth, useFlatPhotos } from '../store';
import { Frame } from '../components/Frame';
import { Bubble, HaloRobot, Icon, Pic, QrCode, Steps } from '../components/basics';
import { back, confirmPrint, finish, resetToWelcome } from '../flow';

function useFrameSlots() {
  const t = useBooth(currentTemplate);
  const photos = useBooth((s) => s.session!.photos);
  const slotsData = useBooth((s) => s.session!.slots);
  const picks = useBooth((s) => s.picks);
  const flat = useFlatPhotos();
  const ids = slotsData.length ? [...slotsData].sort((a, b) => a.slotIndex - b.slotIndex).map((x) => x.photoId) : picks;
  const step = Math.max(1, Math.floor(flat.length / t.photoCount));
  return [...Array(t.photoCount)].map((_, i) => photos.find((p) => p.id === ids[i]) ?? flat[Math.min(flat.length - 1, i * step)]);
}

/** prototype V.final */
export function Final() {
  const t = useBooth(currentTemplate);
  const flat = useFlatPhotos();
  const session = useBooth((s) => s.session)!;
  const edits = useBooth((s) => s.edits);
  const stickers = useBooth((s) => s.stickers);
  const label = useBooth((s) => s.config!.branding.label);
  const busy = useBooth((s) => s.busy);
  const slots = useFrameSlots();
  const serverEdits = Object.fromEntries(session.slots.map((x) => [x.slotIndex, x.edit]));
  const col = (c: number) => {
    const it = [...Array(10)].map((_, j) => flat[(c * 3 + j) % Math.max(1, flat.length)]).filter(Boolean);
    return (
      <div key={c} className="c" style={{ animationDuration: `${100 + c * 14}s` }}>
        {[...it, ...it].map((p, k) => (
          <div key={k} style={{ height: 300, flex: 'none', borderRadius: 28, overflow: 'hidden' }}>
            <Pic url={p.thumbUrl} />
          </div>
        ))}
      </div>
    );
  };
  return (
    <div className="scr en booth-theme">
      <div className="wall">{[0, 1, 2, 3, 4, 5].map(col)}</div>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(250,248,243,.86)', backdropFilter: 'blur(8px)' }} />
      <div className="top" style={{ position: 'relative', zIndex: 2, marginBottom: 0 }}>
        <button className={`btn sm ${busy === 'back' ? 'wait' : ''}`} onClick={back}>
          <Icon n="back" z={30} />
          Kembali
        </button>
        <Steps cur={3} />
      </div>
      <div className="row" style={{ alignItems: 'center', justifyContent: 'center', gap: 96, position: 'relative', zIndex: 2, paddingBottom: 30 }}>
        <div className="float" style={{ animationDuration: '8s' }}>
          <Frame t={t} h={760} mode={2} slots={slots} edits={Object.keys(edits).length ? edits : serverEdits} label={t.label || label} hiRes stickers={stickers} />
        </div>
        <div className="card final-card" style={{ width: 700, padding: '44px 52px', display: 'flex', flexDirection: 'column', gap: 24 }}>
          <div>
            <span className="free-eyebrow"><span>✦</span> CEK TERAKHIR <span>✦</span></span>
            <h1 style={{ margin: '10px 0 0', fontSize: 68 }}>Sudah <em>cantik?</em></h1>
          </div>
          <div className="final-row">
            <span className="free-perk-icon digital"><Icon n="crop" z={32} /></span>
            <span>Frame</span>
            <b>{t.name}</b>
          </div>
          <div className="final-row">
            <span className="free-perk-icon print"><Icon n={session.quantity ? 'print' : 'qr'} z={32} /></span>
            <span>{session.quantity ? 'Jumlah cetak' : 'Paket'}</span>
            <b>{session.quantity ? `${session.quantity}×` : 'Digital saja'}</b>
          </div>
          <p className="p" style={{ fontSize: 26, margin: 0 }}>
            {session.quantity ? 'Foto digital dikirim lewat QR setelah cetak selesai.' : 'Foto digital dikirim lewat QR, tanpa cetak.'}
          </p>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 16, borderTop: '1px solid rgba(105,81,133,.12)' }}>
            <span className="p" style={{ fontSize: 26 }}>Sudah dibayar</span>
            <span style={{ fontSize: 60, fontWeight: 700, color: '#e94f8b' }}>{rp(session.amount)}</span>
          </div>
          <button className={`btn pr ${busy === 'confirm' ? 'wait' : ''}`} style={{ height: 130, fontSize: 46, padding: '0 28px' }} onClick={confirmPrint} data-testid="final-print">
            {session.quantity ? <><Icon n="print" z={56} /> CETAK & SIMPAN</> : <><Icon n="download" z={56} /> SIMPAN</>}
          </button>
        </div>
      </div>
      <footer className="free-footer" style={{ zIndex: 2 }}><span>ROBOT PHOTOBOOTH</span><i /> {t.name}</footer>
    </div>
  );
}

/** prototype V.print — driven by the real print job progress */
export function Print() {
  const session = useBooth((s) => s.session)!;
  const st = session.status;
  const job = session.print;
  const jobFailed = job?.status === 'FAILED' || job?.status === 'RETRYING';
  // The print screen is held for a few seconds after a failure (store.holdPrintUntil)
  // while the server already continues to the gallery.
  const failed = st === 'PRINT_FAILED' || (jobFailed && (st === 'GENERATING_GALLERY' || st === 'QR_READY'));
  const target = st === 'RENDERING' ? 8 : st === 'PRINTING' ? Math.round(10 + 0.88 * (job?.progress ?? 0)) : 100;
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setShown((v) => (v < target ? Math.min(target, v + (target - v > 20 ? 3 : 1)) : v)), 60);
    return () => clearInterval(t);
  }, [target]);

  if (failed) {
    return (
      <div className="scr en booth-theme booth-center" style={{ alignItems: 'center', justifyContent: 'center', gap: 34, textAlign: 'center' }} data-testid="print-failed">
        <HaloRobot m="think" s={300} />
        <span className="free-eyebrow"><span>✦</span> TENANG, FOTOMU AMAN <span>✦</span></span>
        <h2>Cetakan <em>tertunda</em></h2>
        <div style={{ width: 1100 }}>
          <Bubble small="Tenang, fotomu aman. Petugas akan mencetak ulang untukmu. Foto digital tetap bisa diambil lewat QR.">
            {job?.userMessage ?? 'Printer sedang bermasalah.'}
          </Bubble>
        </div>
        <footer className="free-footer"><span>ROBOT PHOTOBOOTH</span><i /> CETAK</footer>
      </div>
    );
  }
  return (
    <div className="scr en booth-theme booth-center" style={{ alignItems: 'center', justifyContent: 'center', gap: 34, textAlign: 'center' }}>
      <HaloRobot m="cam" s={300} />
      <span className="free-eyebrow"><span>✦</span> HAMPIR SELESAI <span>✦</span></span>
      <h2>{session.quantity ? <>Fotomu sedang <em>dicetak</em></> : <>Fotomu sedang <em>disiapkan</em></>}</h2>
      <p className="p" id="pt" data-testid="print-progress">
        {session.quantity ? 'Mencetak…' : 'Menyimpan…'} {shown}%
      </p>
      <div className="bar" style={{ width: 900 }}>
        <i id="pb" style={{ width: `${shown}%` }} />
      </div>
      <footer className="free-footer"><span>ROBOT PHOTOBOOTH</span><i /> {session.quantity ? 'CETAK' : 'SIMPAN'}</footer>
    </div>
  );
}

/** prototype V.qr — QR of the REAL gallery URL */
export function Qr() {
  const t = useBooth(currentTemplate);
  const flat = useFlatPhotos();
  const session = useBooth((s) => s.session)!;
  const label = useBooth((s) => s.config!.branding.label);
  const busy = useBooth((s) => s.busy);
  const slots = useFrameSlots();
  const edits = Object.fromEntries(session.slots.map((x) => [x.slotIndex, x.edit]));
  const stickers = useBooth((s) => s.stickers);
  const url = session.gallery?.url ?? '';
  const preview = session.gallery?.preview;
  const [previewFailed, setPreviewFailed] = useState(false);
  const printProblem = session.print?.status === 'FAILED' || session.print?.status === 'RETRYING';
  return (
    <div className="scr en booth-theme" style={{ paddingBottom: 56 }}>
      <div className="row" style={{ alignItems: 'center', justifyContent: 'center', gap: 96 }}>
        <div className="float" style={{ animationDuration: '8s' }}>
          {preview && !previewFailed ? (
            <img src={preview} alt="Hasil fotomu" draggable={false} onError={() => setPreviewFailed(true)} style={{ height: 780, display: 'block', borderRadius: 24, boxShadow: 'var(--sh)' }} />
          ) : (
            <Frame t={t} h={780} mode={4} slots={slots} edits={edits} cycle={flat} label={t.label || label} hiRes stickers={stickers} />
          )}
        </div>
        <div style={{ flex: 1, maxWidth: 1000, display: 'flex', flexDirection: 'column', gap: 30 }}>
          <div>
            <span className="free-eyebrow"><span>✦</span> TINGGAL SCAN <span>✦</span></span>
            <h2 style={{ marginTop: 10 }}>Foto digitalmu sudah <em>siap</em></h2>
            <p className="p" style={{ marginTop: 12 }}>
              Scan QR untuk melihat atau mengunduh fotomu.
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 56 }}>
            <div className="card" style={{ padding: 36 }} data-testid="gallery-qr" data-url={url} data-avoid="">
              {url ? <QrCode text={url} size={400} level="M" /> : <div className="qrskel" style={{ width: 400, height: 400 }} />}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 28 }}>
              <HaloRobot m="cheer" s={220} />
              <button className={`btn pr ${busy === 'finish' ? 'wait' : ''}`} onClick={finish} data-testid="qr-done">
                SELESAI <Icon n="next" z={36} />
              </button>
            </div>
          </div>
          <p className="p" style={{ fontSize: 30 }}>
            {!session.quantity ? '' : printProblem ? 'Cetakanmu akan dibantu petugas.' : 'Cetakanmu sedang keluar dari mesin.'} {preview && !previewFailed ? 'Versi animasinya juga ikut di link QR.' : `Semua momen dari ${session.plan.angles} angle berganti di dalam frame.`}
          </p>
        </div>
      </div>
      <footer className="free-footer"><span>ROBOT PHOTOBOOTH</span><i /> QR</footer>
    </div>
  );
}

/** prototype V.thanks */
export function Thanks() {
  return (
    <div className="scr en booth-theme booth-center" style={{ alignItems: 'center', justifyContent: 'center', textAlign: 'center', gap: 26 }}>
      <div className="free-spark free-spark-one" aria-hidden="true">✦</div>
      <div className="free-spark free-spark-two" aria-hidden="true">✧</div>
      <HaloRobot m="cheer" s={300} />
      <span className="free-eyebrow"><span>✦</span> SAMPAI JUMPA LAGI <span>✦</span></span>
      <h1 style={{ fontSize: 120 }}>Terima <em>kasih!</em></h1>
      <p className="p" style={{ position: 'relative', fontSize: 44 }}>
        Semoga seru bersama fotografer robotmu!
      </p>
      <button className="btn pr" style={{ position: 'relative', marginTop: 20, height: 130, fontSize: 52 }} onClick={resetToWelcome} data-testid="thanks-home">
        KEMBALI KE AWAL
      </button>
      <footer className="free-footer"><span>ROBOT PHOTOBOOTH</span><i /> TERIMA KASIH</footer>
    </div>
  );
}
