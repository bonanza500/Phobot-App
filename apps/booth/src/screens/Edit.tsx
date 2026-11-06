import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent as RPointerEvent, type WheelEvent as RWheelEvent } from 'react';
import { applyDrag, applyPinch, applyWheel, cssTransform, defaultEdit, fitEdit, restoreIfUncovered, FILTERS, filterById, type EditParams } from '@photobooth/shared';
import { computeFrameLayout } from '@photobooth/shared';
import { restorePhotoPreview } from '../edit-preview';
import { currentTemplate, get, useBooth, useFlatPhotos } from '../store';
import { Frame } from '../components/Frame';
import { Icon, Pic, Steps } from '../components/basics';
import { addSticker, back, editDone, editOf, editOp, removeSticker, selectSlot, setEdit, updateSticker } from '../flow';
import { STICKERS, type Sticker } from '../stickers';
import type { IconName } from '@photobooth/ui';

const FRAME_H = 640;
const clampS = (s: number) => Math.max(0.08, Math.min(0.7, s));

/**
 * prototype V.edit + touch gestures:
 * 1 finger drag, 2 fingers pinch-zoom, double tap reset, mouse wheel zoom.
 * On release the photo snaps back to cover its slot (fitEdit). Stickers sit on top of the frame.
 * Edits are non-destructive parameters; the server renders them at print resolution.
 */
export function Edit() {
  const t = useBooth(currentTemplate);
  const picks = useBooth((s) => s.picks);
  const photos = useBooth((s) => s.session!.photos);
  const edits = useBooth((s) => s.edits);
  const stickers = useBooth((s) => s.stickers);
  const slot = useBooth((s) => s.slot);
  const label = useBooth((s) => s.config!.branding.label);
  const busy = useBooth((s) => s.busy);
  const flat = useFlatPhotos();
  const n = t.photoCount;
  const slots = [...Array(n)].map((_, i) => photos.find((p) => p.id === picks[i]));
  const e = edits[slot] ?? defaultEdit();
  const current = slots[slot] ?? flat[0];
  const layout = computeFrameLayout(t, FRAME_H);
  const frameRef = useRef<HTMLDivElement>(null);

  // ---- gestures (port of prototype pd/pm/pu with normalized coordinates)
  const PT = useRef(new Map<number, { x: number; y: number }>());
  const base = useRef<{ e: EditParams; p: { x: number; y: number }[]; k: number; d?: number; slot: number } | null>(null);
  const dtap = useRef(0);
  const live = useRef<EditParams | null>(null);

  const stageScale = () => {
    const st = document.getElementById('st');
    return st ? st.getBoundingClientRect().width / 1920 : 1;
  };

  const snap = (i: number) => {
    const p = [...PT.current.values()];
    const b: NonNullable<typeof base.current> = { e: { ...(live.current ?? editOf(i)) }, p: p.map((q) => ({ ...q })), k: stageScale(), slot: i };
    if (p.length > 1) b.d = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
    base.current = b;
  };

  const phEl = (i: number) => frameRef.current?.querySelectorAll<HTMLElement>('.slot')[i]?.querySelector<HTMLElement>('.ph');
  const paint = (i: number, ed: EditParams) => {
    const el = phEl(i);
    const r = layout.slots[i];
    if (el && r) {
      el.style.transition = 'none';
      el.style.transform = cssTransform(ed, r.w, r.h);
      el.style.filter = `brightness(${ed.brightness}) ${filterById(ed.filter).css}`;
    }
  };

  const onMove = useCallback((ev: PointerEvent) => {
    if (!PT.current.has(ev.pointerId) || !base.current) return;
    PT.current.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    const b = base.current;
    const p = [...PT.current.values()];
    const r = layout.slots[b.slot];
    let ed = b.e;
    if (p.length == 1) ed = applyDrag(b.e, (p[0].x - b.p[0].x) / b.k, (p[0].y - b.p[0].y) / b.k, r.w, r.h);
    else if (b.d && b.p.length > 1) {
      const d = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
      ed = applyPinch(
        b.e,
        d / b.d,
        0,
        (p[0].x + p[1].x - (b.p[0].x + b.p[1].x)) / 2 / b.k,
        (p[0].y + p[1].y - (b.p[0].y + b.p[1].y)) / 2 / b.k,
        r.w,
        r.h,
      );
    }
    live.current = ed;
    paint(b.slot, ed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t.id]);

  const onUp = useCallback((ev: PointerEvent) => {
    PT.current.delete(ev.pointerId);
    const b = base.current;
    if (PT.current.size && b) {
      snap(b.slot);
      return;
    }
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    // Out of the slot → glide back so the photo fills it again.
    if (b && live.current) {
      const el = phEl(b.slot);
      const next = restoreIfUncovered(live.current);
      if (el) restorePhotoPreview(el.style, next, layout.slots[b.slot]);
      setEdit(b.slot, next);
    }
    live.current = null;
    base.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onMove]);

  useEffect(
    () => () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    },
    [onMove, onUp],
  );

  const onDown = (ev: RPointerEvent<HTMLDivElement>, i: number) => {
    ev.preventDefault();
    setActiveSticker(null);
    if (get().slot !== i) selectSlot(i);
    PT.current.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    const now = Date.now();
    if (PT.current.size == 1 && now - dtap.current < 320) {
      dtap.current = 0;
      PT.current.clear();
      live.current = null;
      base.current = null;
      setEdit(i, defaultEdit());
      return;
    }
    if (PT.current.size == 1) dtap.current = now;
    snap(i);
    if (PT.current.size === 1) {
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    }
  };

  const onWheel = (ev: RWheelEvent<HTMLDivElement>, i: number) => {
    if (get().slot !== i) selectSlot(i);
    setEdit(i, fitEdit(applyWheel(editOf(i), ev.deltaY)));
  };

  // ---- stickers: 1 finger move, 2 fingers / wheel resize, tap selects, × removes
  const [activeSticker, setActiveSticker] = useState<number | null>(null);
  const SP = useRef(new Map<number, { x: number; y: number }>());
  const sBase = useRef<{ id: number; st: Sticker; p: { x: number; y: number }[]; k: number; d?: number } | null>(null);
  const sSnap = (id: number) => {
    const st = get().stickers.find((s) => s.id === id);
    if (!st) return;
    const p = [...SP.current.values()].map((q) => ({ ...q }));
    sBase.current = { id, st: { ...st }, p, k: stageScale(), d: p.length > 1 ? Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) : undefined };
  };
  const sMove = useCallback((ev: PointerEvent) => {
    if (!SP.current.has(ev.pointerId) || !sBase.current) return;
    SP.current.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    const b = sBase.current;
    const p = [...SP.current.values()];
    if (p.length === 1) {
      const x = b.st.x + (p[0].x - b.p[0].x) / b.k / layout.width;
      const y = b.st.y + (p[0].y - b.p[0].y) / b.k / layout.height;
      updateSticker(b.id, { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) });
    } else if (b.d) {
      updateSticker(b.id, { s: clampS(b.st.s * (Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) / b.d)) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t.id]);
  const sUp = useCallback((ev: PointerEvent) => {
    SP.current.delete(ev.pointerId);
    if (SP.current.size && sBase.current) return sSnap(sBase.current.id);
    window.removeEventListener('pointermove', sMove);
    window.removeEventListener('pointerup', sUp);
    window.removeEventListener('pointercancel', sUp);
    sBase.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sMove]);
  useEffect(
    () => () => {
      window.removeEventListener('pointermove', sMove);
      window.removeEventListener('pointerup', sUp);
      window.removeEventListener('pointercancel', sUp);
    },
    [sMove, sUp],
  );
  const onStickerDown = (ev: RPointerEvent<HTMLDivElement>, id: number) => {
    ev.preventDefault();
    ev.stopPropagation();
    setActiveSticker(id);
    SP.current.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    sSnap(id);
    if (SP.current.size === 1) {
      window.addEventListener('pointermove', sMove);
      window.addEventListener('pointerup', sUp);
      window.addEventListener('pointercancel', sUp);
    }
  };
  const onStickerWheel = (ev: RWheelEvent<HTMLDivElement>, id: number) => {
    const st = get().stickers.find((s) => s.id === id);
    if (st) updateSticker(id, { s: clampS(st.s * Math.exp(-ev.deltaY * 0.0015)) });
  };
  const onRemove = (id: number) => {
    removeSticker(id);
    setActiveSticker(null);
  };

  const T = (i: IconName, l: string, a: () => void, id: string) => (
    <button className="btn tool" onClick={a} data-testid={`tool-${id}`}>
      <span>
        <Icon n={i} z={46} />
      </span>
      {l}
    </button>
  );

  const selectFilter = (filter: (typeof FILTERS)[number]) => editOp({ op: 'filter', filter: filter.id });
  const onFilterKey = (ev: KeyboardEvent<HTMLDivElement>, filter: (typeof FILTERS)[number]) => {
    if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault();
      selectFilter(filter);
    }
    if (ev.key === 'ArrowRight' || ev.key === 'ArrowDown' || ev.key === 'ArrowLeft' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      const items = Array.from(ev.currentTarget.parentElement?.querySelectorAll<HTMLElement>('[role="radio"]') ?? []);
      const index = items.indexOf(ev.currentTarget);
      const next = items[(index + (ev.key === 'ArrowRight' || ev.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length];
      next?.focus();
      const nextFilter = FILTERS.find((f) => f.id === next?.dataset.filter);
      if (nextFilter) selectFilter(nextFilter);
    }
  };

  return (
    <div className="scr en booth-theme" style={{ paddingTop: 40, paddingBottom: 56 }}>
      <div className="top" style={{ marginBottom: 0 }}>
        <button className={`btn sm ${busy === 'back' ? 'wait' : ''}`} onClick={back}>
          <Icon n="back" z={30} />
          Foto
        </button>
        <Steps cur={2} />
      </div>
      <header className="booth-hero sm">
        <span className="free-eyebrow"><span>✦</span> SENTUHAN AKHIR <span>✦</span></span>
        <h1>Percantik <em>fotomu</em></h1>
        <p className="p">
          <span className="chip b" data-testid="edit-chip">Sedang mengedit foto {slot + 1} dari {n}</span>
        </p>
      </header>
      <div className="row edit-layout" style={{ justifyContent: 'center', alignItems: 'center', gap: 64 }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }} ref={frameRef}>
          <Frame
            t={t}
            h={FRAME_H}
            mode={1}
            slots={slots}
            edits={edits}
            activeSlot={slot}
            label={t.label || label}
            hiRes
            onSlotPointerDown={onDown}
            onSlotWheel={onWheel}
            stickers={stickers}
            activeSticker={activeSticker}
            onStickerPointerDown={onStickerDown}
            onStickerWheel={onStickerWheel}
            onStickerRemove={onRemove}
          />
          <div className="p" style={{ fontSize: 26 }}>
            Ketuk foto di frame untuk memilih
          </div>
        </div>
        <div className="edit-controls">
          <div className="card" style={{ padding: 18 }}>
            <div style={{ fontSize: 26, fontWeight: 700, marginBottom: 12 }}>
              <Icon n="sparkle" z={30} /> Tambah stiker <span className="p" style={{ fontSize: 22, fontWeight: 500 }}>· geser, cubit untuk ukuran</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8,1fr)', gap: 10 }}>
              {STICKERS.map((s) => (
                <button
                  key={s.k}
                  className="btn"
                  aria-label={`Stiker ${s.k}`}
                  data-testid={`sticker-add-${s.k}`}
                  onClick={() => setActiveSticker(addSticker(s.k))}
                  style={{ aspectRatio: '1', height: 'auto', padding: 6, borderRadius: 18 }}
                >
                  <img src={s.url} alt="" draggable={false} style={{ width: '100%', height: '100%', objectFit: 'contain', pointerEvents: 'none' }} />
                </button>
              ))}
            </div>
          </div>
          <div className="card edit-filters" role="radiogroup" aria-label="Filter foto" style={{ padding: 18, display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 12 }}>
            {FILTERS.map((f) => (
              <div key={f.id} role="radio" aria-checked={e.filter === f.id} tabIndex={e.filter === f.id ? 0 : -1} onClick={() => selectFilter(f)} onKeyDown={(ev) => onFilterKey(ev, f)} style={{ textAlign: 'center', fontSize: 24, fontWeight: 600, cursor: 'pointer' }} data-filter={f.id} data-testid={`filter-${f.id}`}>
                <div className={`th ${e.filter == f.id ? 'sel' : ''}`} style={{ aspectRatio: '1', borderRadius: 20, marginBottom: 6 }}>
                  <Pic url={current?.thumbUrl} style={{ filter: f.css }} />
                  <span className="edit-filter-icon" aria-hidden><Icon n={f.id === 'original' ? 'cam' : f.id === 'warm' ? 'sun' : f.id === 'cool' ? 'moon' : f.id === 'mono' ? 'contrast' : 'sparkle'} z={24} /></span>
                </div>
                {f.label}
              </div>
            ))}
          </div>
          <div className="edit-tools">
            {T('sun', 'Terang +', () => editOp({ op: 'brightness', delta: 0.1 }), 'bright-up')}
            {T('moon', 'Terang −', () => editOp({ op: 'brightness', delta: -0.1 }), 'bright-down')}
            {T('reset', 'Reset', () => editOp({ op: 'reset' }), 'reset')}
          </div>
          <button className={`btn pr ${busy === 'edit_done' ? 'wait' : ''}`} style={{ height: 112 }} onClick={editDone} data-testid="edit-done">
            SELESAI <Icon n="next" z={36} />
          </button>
        </div>
      </div>
      <footer className="free-footer"><span>ROBOT PHOTOBOOTH</span><i /> {t.name}</footer>
    </div>
  );
}
