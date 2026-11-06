import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { computeFrameLayout, type PhotoTemplate } from '@photobooth/shared';
import { currentTemplate, slotRatio, useBooth, useFlatPhotos } from '../store';
import { fitGrid } from '../fitGrid';
import { Frame } from '../components/Frame';
import { Icon, Pic, Steps } from '../components/basics';
import { autoPick, back, chooseTemplate, clearPicks, confirmPicks, confirmTemplate, togglePick } from '../flow';
import { voice } from '../voice';

/** prototype V.tpl */
export function Tpl() {
  const allTemplates = useBooth((s) => s.config!.templates);
  const tplId = useBooth((s) => currentTemplate(s).id);
  const flat = useFlatPhotos();
  const label = useBooth((s) => s.config!.branding.label);
  const busy = useBooth((s) => s.busy);
  // Chosen before capture, so every enabled frame is offered.
  const templates = allTemplates;
  // Step 1 groups frames by photo count; step 2 picks a design inside one group.
  const groups = [...new Set(templates.map((t) => t.photoCount))].sort((a, b) => a - b).map((n) => ({ n, items: templates.filter((t) => t.photoCount === n) }));
  const [count, setCount] = useState<number | null>(groups.length === 1 ? groups[0].n : null);
  const group = groups.find((g) => g.n === count);
  const cur = templates.find((t) => t.id === tplId);
  const sample = (t: PhotoTemplate) => {
    const step = Math.max(1, Math.floor(flat.length / t.photoCount));
    return [...Array(t.photoCount)].map((_, i) => flat[Math.min(flat.length - 1, i * step)]);
  };
  const openGroup = (g: (typeof groups)[number]) => {
    if (cur?.photoCount !== g.n) chooseTemplate(g.items[0].id);
    setCount(g.n);
    voice('tpl_group');
  };
  // Paid already: step 1 has nothing to go back to.
  const canBack = !!group && groups.length > 1;
  const goBack = () => canBack && setCount(null);

  // Measure the grid box so cards are sized to fit it (never overlap).
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setSize((s) => (s.w === el.clientWidth && s.h === el.clientHeight ? s : { w: el.clientWidth, h: el.clientHeight }));
    measure(); // sync on step change (footer toggles) so cards never render with stale size
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [count]);

  const items = group ? group.items : groups.map((g) => g.items[0]);
  const ratio = Math.max(...items.map((t) => t.aspectRatio));
  const chromeH = group ? CARD_CHROME_H : TYPE_CHROME_H;
  const g = fitGrid(items.length, size.w, size.h, ratio, GAP, CARD_CHROME_W, chromeH, group ? 200 : 260);
  const frameW = Math.floor(g.frameH * ratio);
  const card = { padding: CARD_PAD, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, cursor: 'pointer', width: frameW + CARD_CHROME_W } as const;
  const preview = (t: PhotoTemplate) => (
    <div style={{ height: g.frameH, width: frameW, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <Frame t={t} h={Math.min(g.frameH, frameW / t.aspectRatio)} mode={0} slots={sample(t)} label={t.label || label} />
    </div>
  );
  // Scroll only the grid box. scrollIntoView would also scroll the #st stage and shift the whole screen.
  useEffect(() => {
    const el = box.current;
    const sel = el?.querySelector<HTMLElement>('[data-sel]');
    if (el) el.scrollTop = g.scroll && sel ? Math.max(0, sel.offsetTop - el.offsetTop - GAP) : 0;
  }, [count, g.scroll]);
  const ellipsis = { width: '100%', textAlign: 'center', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: 1.2 } as const;

  return (
    <div className="scr en booth-theme" style={{ paddingTop: 40, paddingBottom: 60 }}>
      <div className="top" style={{ marginBottom: 0 }}>
        <button className="btn sm" onClick={goBack} style={{ visibility: canBack ? 'visible' : 'hidden' }}>
          <Icon n="back" z={30} /> Kembali
        </button>
        <Steps cur={1} />
      </div>
      <header className="booth-hero">
        <span className="free-eyebrow"><span>✦</span> PILIH GAYAMU <span>✦</span></span>
        <h1>{group ? <>Pilih frame <em>{group.n} foto</em></> : <>Pilih <em>tipe frame</em></>}</h1>
        <p className="p">
          {group ? 'Ketuk desain favoritmu' : 'Mau berapa foto dalam satu frame?'}
          <span className="chip b">{group ? `${group.items.length} desain` : `${groups.length} tipe`}</span>
        </p>
      </header>
      <div
        ref={box}
        style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: `repeat(${g.cols}, auto)`, gap: GAP, justifyContent: 'center', alignContent: g.scroll ? 'start' : 'center', overflowX: 'hidden', overflowY: g.scroll ? 'auto' : 'hidden' }}
      >
        {size.w > 0 &&
          (group
            ? group.items.map((t) => {
                const sel = tplId === t.id;
                return (
                  <div
                    key={t.id}
                    className="card"
                    data-tap=""
                    data-sel={sel ? '' : undefined}
                    data-testid={`tpl-${t.id}`}
                    onClick={() => chooseTemplate(t.id)}
                    style={{ ...card, border: `${CARD_BORDER}px solid ${sel ? '#f05b9b' : 'transparent'}` }}
                  >
                    {preview(t)}
                    <div style={{ ...ellipsis, fontSize: 28, fontWeight: 600 }}>{t.name}</div>
                    <div className={`chip ${sel ? 'b' : ''}`} style={{ height: 44, fontSize: 22, padding: '0 20px' }}>
                      {sel ? 'Dipilih' : `${t.photoCount} foto`}
                    </div>
                  </div>
                );
              })
            : groups.map((gr) => {
                const sel = cur?.photoCount === gr.n;
                return (
                  <div
                    key={gr.n}
                    className="card"
                    data-tap=""
                    data-sel={sel ? '' : undefined}
                    data-testid={`tpl-type-${gr.n}`}
                    onClick={() => openGroup(gr)}
                    style={{ ...card, border: `${CARD_BORDER}px solid ${sel ? '#f05b9b' : 'transparent'}` }}
                  >
                    {preview(gr.items[0])}
                    <div style={{ ...ellipsis, fontSize: 40, fontWeight: 700 }}>{gr.n} Foto</div>
                    <div className={`chip ${sel ? 'b' : ''}`} style={{ height: 44, fontSize: 22, padding: '0 20px' }}>
                      {gr.items.length} desain
                    </div>
                  </div>
                );
              }))}
      </div>
      {group && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 20 }}>
          <div className="chip" style={{ maxWidth: 1100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block', lineHeight: '72px' }}>
            Dipilih: {cur?.name ?? '-'}
          </div>
          <button className={`btn pr ${busy === 'frame' ? 'wait' : ''}`} onClick={confirmTemplate} data-testid="tpl-next">
            PILIH FRAME <Icon n="next" z={36} />
          </button>
        </div>
      )}
      <footer className="free-footer"><span>ROBOT PHOTOBOOTH</span><i /> PILIH FRAME</footer>
    </div>
  );
}

const GAP = 24;
const CARD_PAD = 14;
const CARD_BORDER = 6;
const CARD_CHROME_W = 2 * (CARD_PAD + CARD_BORDER) + 4;
/** padding+border (40) + 2 gaps (20) + name line (~34 / ~48) + chip (44) + slack */
const CARD_CHROME_H = 40 + 20 + 34 + 44 + 8;
const TYPE_CHROME_H = 40 + 20 + 48 + 44 + 8;

/** prototype V.pick */
export function Pick() {
  const t = useBooth(currentTemplate);
  const flat = useFlatPhotos();
  const picks = useBooth((s) => s.picks);
  const photos = useBooth((s) => s.session!.photos);
  const label = useBooth((s) => s.config!.branding.label);
  const busy = useBooth((s) => s.busy);
  const n = t.photoCount;
  const k = picks.length;
  const slots = [...Array(n)].map((_, i) => photos.find((p) => p.id === picks[i]));
  const ratio = useBooth(slotRatio);

  // Measure grid + frame column so thumbnails and the frame fill the screen.
  const grid = useRef<HTMLDivElement>(null);
  const side = useRef<HTMLDivElement>(null);
  const [gs, setGs] = useState({ w: 0, h: 0 });
  const [fh, setFh] = useState(0);
  useLayoutEffect(() => {
    const g = grid.current;
    const f = side.current;
    if (!g || !f) return;
    const measure = () => {
      setGs((s) => (s.w === g.clientWidth && s.h === g.clientHeight ? s : { w: g.clientWidth, h: g.clientHeight }));
      setFh(f.clientHeight);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(g);
    ro.observe(f);
    return () => ro.disconnect();
  }, []);
  const PG = 16;
  const fit = fitGrid(flat.length, gs.w, gs.h, ratio, PG, 0, 0, 180);
  // Few photos: cap at half the grid height so they don't balloon.
  const thumbH = Math.min(fit.frameH, gs.h / 2 - PG);
  const frameH = Math.max(0, fh);
  const frameW = Math.min(computeFrameLayout(t, frameH).width, 620);

  return (
    <div className="scr en booth-theme" style={{ paddingTop: 40, paddingBottom: 56 }}>
      <div className="top" style={{ marginBottom: 0 }}>
        <button className={`btn sm ${busy === 'back' ? 'wait' : ''}`} onClick={back}>
          <Icon n="back" z={30} />
          Kembali
        </button>
        <Steps cur={2} />
      </div>
      <header className="booth-hero sm">
        <span className="free-eyebrow"><span>✦</span> ISI FRAME-MU <span>✦</span></span>
        <h1>Pilih foto untuk <em>dicetak</em></h1>
        <p className="p">
          Ketuk {n} foto favoritmu. Urutannya mengikuti posisi di frame.
          <span className={`chip ${k == n ? 'y' : 'b'}`} data-testid="pick-count">✓ {k} / {n} foto</span>
        </p>
      </header>
      <div className="row" style={{ gap: 56, minHeight: 0 }}>
        <div className="card" style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, padding: 24, borderRadius: 36 }} data-avoid>
          <div
            ref={grid}
            style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: `repeat(${fit.cols}, auto)`, gap: PG, justifyContent: 'center', alignContent: fit.scroll ? 'start' : 'center', overflowX: 'hidden', overflowY: fit.scroll ? 'auto' : 'hidden' }}
          >
            {gs.w > 0 &&
              flat.map((p) => {
                const i = picks.indexOf(p.id);
                return (
                  <div key={p.id} className={`th ${i >= 0 ? 'sel' : ''}`} data-n={i + 1} style={{ width: thumbH * ratio, height: thumbH }} onClick={() => togglePick(p.id)} data-testid="pick-photo">
                    <Pic url={p.thumbUrl} />
                    <i className="tl">Angle {p.angle + 1}</i>
                  </div>
                );
              })}
          </div>
        </div>
        <div ref={side} style={{ width: frameW || 520, flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 0 }}>
          {frameH > 0 && <Frame t={t} h={Math.min(frameH, 620 / t.aspectRatio)} mode={3} slots={slots} label={t.label || label} />}
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 22 }}>
        <div style={{ display: 'flex', gap: 16 }}>
          <button className="btn sm" onClick={autoPick} data-testid="pick-auto">
            <Icon n="auto" z={30} /> Pilih otomatis
          </button>
          <button className="btn sm" onClick={clearPicks}>
            Hapus pilihan
          </button>
        </div>
        <button className={`btn pr ${busy === 'photos' ? 'wait' : ''}`} disabled={k != n} onClick={confirmPicks} data-testid="pick-next">
          LANJUT <Icon n="next" z={36} />
        </button>
      </div>
      <footer className="free-footer"><span>ROBOT PHOTOBOOTH</span><i /> {t.name}</footer>
    </div>
  );
}

