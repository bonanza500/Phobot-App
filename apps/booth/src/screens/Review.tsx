import { useLayoutEffect, useRef, useState } from 'react';
import { p2, retakesLeft } from '@photobooth/shared';
import { flatPhotos, slotRatio, useBooth } from '../store';
import { fitCards, fitGrid } from '../fitGrid';
import { Icon, Pic } from '../components/basics';
import { closeLightbox, retake, tapReviewPhoto, toFrames } from '../flow';

/** prototype V.review */
export function Review() {
  const session = useBooth((s) => s.session)!;
  const busy = useBooth((s) => s.busy);
  const flatCount = useBooth((s) => flatPhotos(s).length);
  const { angles, shotsPerAngle, retakeLimit } = session.plan;
  const left = retakesLeft(session.retakenAngles, retakeLimit);
  const ratio = useBooth(slotRatio);

  // Card grid follows the screen: pick the cols/rows that give the biggest photo.
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setSize((s) => (s.w === el.clientWidth && s.h === el.clientHeight ? s : { w: el.clientWidth, h: el.clientHeight }));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const chromeH = CARD_PAD_Y * 2 + HEAD_H + IN_GAP + (left ? BTN_H + IN_GAP : 0);
  // Card shape follows the frame's slot ratio and how many photos sit in it (side by side or stacked).
  const g = fitCards(angles, shotsPerAngle, size.w, size.h, ratio, GRID_GAP, CARD_PAD_X * 2, chromeH, 60, MIN_CARD_W);
  const areaW = Math.floor(g.frameH * g.areaRatio);
  const areaH = g.frameH;
  const short = areaW < 340;
  /** 1 photo fills the area; 2+ split it (side by side or stacked, whichever is bigger). */
  const thumb = (n: number) => {
    const f = fitGrid(Math.max(1, n), areaW, areaH, ratio, PHOTO_GAP, 0, 0, 0);
    return { cols: f.cols, h: f.frameH, w: Math.floor(f.frameH * ratio) };
  };
  return (
    <div className="scr en" style={{ paddingTop: 40, paddingBottom: 36 }}>
      <div className="top" style={{ height: 90, marginBottom: 24 }}>
        <div>
          <h2 style={{ fontSize: 52 }}>Momen manismu ✨</h2>
          <div className="p" style={{ fontSize: 30, marginTop: 8 }}>
            Ketuk foto untuk melihat lebih dekat · pilih {shotsPerAngle} foto terbaik per angle.
          </div>
        </div>
        <div className={`chip ${left ? 'y' : ''}`} data-testid="retakes-left">
          {left ? `♡ ${left} kesempatan ulang` : '✓ Semua kesempatan dipakai'}
        </div>
      </div>
      <div
        ref={box}
        style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: `repeat(${g.cols}, auto)`, gap: GRID_GAP, justifyContent: 'center', alignContent: g.scroll ? 'start' : 'center', overflowX: 'hidden', overflowY: g.scroll ? 'auto' : 'hidden' }}
      >
        {size.w > 0 && [...Array(angles)].map((_, a) => {
          const ps = session.photos.filter((p) => p.angle === a).sort((x, y) => x.shot - y.shot);
          const m = ps.length > shotsPerAngle;
          const th = thumb(ps.length);
          return (
            <div key={a} className={`card review-card ${m ? 'review-picking' : ''}`} style={{ padding: `${CARD_PAD_Y}px ${CARD_PAD_X}px`, display: 'flex', flexDirection: 'column', gap: IN_GAP, borderRadius: 30, width: areaW + CARD_PAD_X * 2, height: areaH + chromeH }} data-testid={`review-angle-${a}`}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 30, fontWeight: 600, gap: 8, height: HEAD_H, whiteSpace: 'nowrap', overflow: 'hidden' }}>
                <span>♡ Angle {p2(a + 1)}</span>
                {m ? (
                  <span style={{ color: 'var(--bl)', fontSize: 24 }}>
                    pilih {shotsPerAngle} dari {ps.length}
                  </span>
                ) : null}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: `repeat(${th.cols}, auto)`, gap: PHOTO_GAP, flex: 1, minHeight: 0, justifyContent: 'center', alignContent: 'center' }}>
                {ps.map((p) => (
                  <div key={p.id} className={`th review-photo ${m && p.selected ? 'sel' : ''}`} style={{ width: th.w, height: th.h, borderWidth: 4 }} onClick={() => tapReviewPhoto(a, p.id)} aria-label={`Angle ${a + 1}, foto ${p.shot}`}>
                    <Pic url={p.thumbUrl} />
                    {m && p.selected ? <span className="review-selected">Pilihan</span> : null}
                  </div>
                ))}
                {ps.length ? null : <div className="th review-empty" style={{ width: th.w, height: th.h, borderWidth: 4, cursor: 'default' }} aria-label={`Angle ${a + 1} belum ada foto`} />}
              </div>
              {session.retakenAngles.includes(a) || !left ? null : (
                <button className={`btn sm review-retake ${busy === 'retake' ? 'wait' : ''}`} style={{ height: BTN_H, fontSize: 26, flex: 'none' }} onClick={() => retake(a)} data-testid={`retake-${a}`} aria-label={ps.length ? 'Coba angle ini lagi' : 'Ambil angle ini'}>
                  <Icon n={ps.length ? 'rot' : 'cam'} z={26} /> {ps.length ? (short ? 'Ulangi' : 'Coba angle ini lagi') : short ? 'Ambil' : 'Ambil angle ini'}
                </button>
              )}
            </div>
          );
        })}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16 }}>
        <div className="p" style={{ fontSize: 28 }}>
          ✨ {flatCount} foto dipilih · semua momen tetap tersimpan
        </div>
        <button className={`btn pr ${busy === 'frames' ? 'wait' : ''}`} onClick={toFrames} data-testid="review-next">
          LANJUT <Icon n="next" z={36} />
        </button>
      </div>
    </div>
  );
}

const GRID_GAP = 24;
const CARD_PAD_X = 18;
const CARD_PAD_Y = 16;
const HEAD_H = 40;
const BTN_H = 60;
const IN_GAP = 12;
const PHOTO_GAP = 10;
const MIN_CARD_W = 260;

/** Review photo enlarged (prototype S.big overlay) */
export function Lightbox() {
  const big = useBooth((s) => s.big);
  const photo = useBooth((s) => s.session?.photos.find((p) => p.id === s.big));
  if (!big || !photo) return null;
  return (
    <div className="lbx" onClick={closeLightbox} data-testid="lightbox">
      <div className="big">
        <Pic url={photo.previewUrl} />
      </div>
      <div className="btn" style={{ position: 'absolute', right: 80, top: 60 }}>
        <Icon n="x" z={36} /> Tutup
      </div>
    </div>
  );
}
