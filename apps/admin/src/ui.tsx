import { useEffect, useRef, useState, type ReactNode } from 'react';

type Toast = { id: number; text: string; err?: boolean };
let push: ((t: Omit<Toast, 'id'>) => void) | null = null;

export function toast(text: string, err = false) {
  push?.({ text, err });
}

export function Toasts() {
  const [list, setList] = useState<Toast[]>([]);
  useEffect(() => {
    push = (t) => {
      const id = Date.now() + Math.random();
      setList((l) => [...l, { ...t, id }]);
      setTimeout(() => setList((l) => l.filter((x) => x.id !== id)), 4500);
    };
    return () => {
      push = null;
    };
  }, []);
  return (
    <>
      {list.map((t, i) => (
        <div key={t.id} className={`toast ${t.err ? 'err' : ''}`} style={{ bottom: 20 + i * 64 }}>
          {t.text}
        </div>
      ))}
    </>
  );
}

/** Polls a loader; returns [data, reload, error]. */
export function usePoll<T>(loader: () => Promise<T>, intervalMs = 0, deps: unknown[] = []): [T | null, () => Promise<void>, string | null] {
  const [data, setData] = useState<T | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const ref = useRef(loader);
  ref.current = loader;
  const reload = async () => {
    try {
      setData(await ref.current());
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  useEffect(() => {
    void reload();
    if (!intervalMs) return;
    const t = setInterval(() => void reload(), intervalMs);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return [data, reload, err];
}

export function statusChip(status: string) {
  const s = status.toUpperCase();
  const cls =
    ['OK', 'COMPLETED', 'PAID', 'SUCCESS', 'ACTIVE', 'ONLINE', 'FINISHED', 'QR_READY', 'DONE', 'READY', 'PRINT_SUCCESS', 'INFO'].includes(s)
      ? 'ok'
      : ['ERROR', 'FAILED', 'DOWN', 'PRINT_FAILED', 'CANCELLED', 'EXPIRED'].includes(s)
        ? 'err'
        : ['DEGRADED', 'RETRYING', 'PENDING', 'PENDING_PAYMENT', 'SHOOTING', 'INACTIVE', 'WAITING_PAYMENT', 'WARN', 'QUEUED', 'UNKNOWN', 'PRINTING', 'RENDERING', 'UPLOADING'].includes(s)
          ? 'warn'
          : '';
  return <span className={`chip ${cls}`}>{status}</span>;
}

export function Pager({ meta, onPage }: { meta?: { total: number; page: number; lastPage: number }; onPage: (p: number) => void }) {
  if (!meta) return null;
  return (
    <div className="row" style={{ marginTop: 12 }}>
      <span className="small mu">{meta.total} data</span>
      <span className="spacer" />
      <button className="btn" disabled={meta.page <= 1} onClick={() => onPage(meta.page - 1)}>
        ‹ Sebelumnya
      </button>
      <span className="small">
        {meta.page} / {meta.lastPage}
      </span>
      <button className="btn" disabled={meta.page >= meta.lastPage} onClick={() => onPage(meta.page + 1)}>
        Berikutnya ›
      </button>
    </div>
  );
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);
  return (
    <div className="modal" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="card" role="dialog" aria-modal="true" aria-label={title}>
        <div className="row">
          <h2 style={{ margin: 0 }}>{title}</h2>
          <span className="spacer" />
          <button className="btn" onClick={onClose} aria-label="Tutup">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="card kpi">
      <div className="l">{label}</div>
      <div className="v">{value}</div>
      {sub ? <div className="small mu">{sub}</div> : null}
    </div>
  );
}

/** "+12.5% vs kemarin" with color. */
export function Delta({ pct, label = 'vs kemarin' }: { pct: number; label?: string }) {
  return (
    <span style={{ color: pct > 0 ? 'var(--ok)' : pct < 0 ? 'var(--er)' : 'var(--mu)' }}>
      {pct > 0 ? '▲' : pct < 0 ? '▼' : '•'} {Math.abs(pct).toFixed(1)}% {label}
    </span>
  );
}

export function useAction() {
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (name: string, fn: () => Promise<unknown>, okText?: string) => {
    setBusy(name);
    try {
      const r = await fn();
      const msg = okText ?? (r && typeof r === 'object' && 'message' in (r as object) ? String((r as { message: string }).message) : 'Done');
      toast(msg, !!r && typeof r === 'object' && (r as { ok?: boolean }).ok === false);
      return r;
    } catch (e) {
      toast((e as Error).message, true);
      return null;
    } finally {
      setBusy(null);
    }
  };
  return { busy, run };
}
