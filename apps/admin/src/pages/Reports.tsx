import { useState } from 'react';
import { download, dt, get, qs, rp, type Page } from '../api';
import { Delta, Modal, Pager, Stat, statusChip, toast, usePoll } from '../ui';

interface Tx {
  id: string;
  session_id: string;
  midtrans_order_id: string;
  amount: number;
  status: string;
  paid_at?: string;
  created_at: string;
  voucher?: { code: string; discount: number };
  package?: { name: string };
  frame?: { name: string };
}
interface TxStats {
  total: number;
  totalChangePct: number;
  revenue: number;
  revenueChangePct: number;
  successful: number;
  successfulChangePct: number;
  failed: number;
  failedChangePct: number;
}

const STATUS: [string, string][] = [
  ['', 'Semua status'],
  ['success', 'Berhasil'],
  ['pending', 'Menunggu'],
  ['failed', 'Gagal'],
  ['expired', 'Kedaluwarsa'],
  ['cancelled', 'Dibatalkan'],
];

/** Laporan transaksi: statistik, filter tanggal/status, detail, unduh CSV. */
export function Reports() {
  const [f, setF] = useState({ search: '', status: '', from: '', to: '', page: 1 });
  const filter = { search: f.search, status: f.status, from: f.from, to: f.to };
  const [list, , err] = usePoll<Page<Tx>>(() => get(`/api/admin/transactions?${qs({ ...filter, page: f.page, limit: 20 })}`), 0, [JSON.stringify(f)]);
  const [stats] = usePoll<TxStats>(() => get('/api/admin/transactions/stats'), 30_000);
  const [open, setOpen] = useState<Tx | null>(null);
  const set = (p: Partial<typeof f>) => setF((o) => ({ ...o, page: 1, ...p }));

  const exportCsv = () =>
    download(`/api/admin/transactions/export?${qs(filter)}`, `transaksi-${f.from || 'awal'}_${f.to || 'sekarang'}.csv`).catch((e) => toast((e as Error).message, true));

  return (
    <div className="grid">
      <h1>Laporan</h1>
      {stats ? (
        <div className="grid g6">
          <Stat label="Total transaksi" value={stats.total} sub={<Delta pct={stats.totalChangePct} />} />
          <Stat label="Pendapatan" value={rp(stats.revenue)} sub={<Delta pct={stats.revenueChangePct} />} />
          <Stat label="Berhasil" value={stats.successful} sub={<Delta pct={stats.successfulChangePct} />} />
          <Stat label="Gagal" value={stats.failed} sub={<Delta pct={stats.failedChangePct} />} />
        </div>
      ) : null}

      <div className="card">
        <div className="form" style={{ alignItems: 'end' }}>
          <label className="f">
            Cari (ID / order / sesi)
            <input value={f.search} onChange={(e) => set({ search: e.target.value })} />
          </label>
          <label className="f">
            Status
            <select value={f.status} onChange={(e) => set({ status: e.target.value })}>
              {STATUS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label className="f">
            Dari tanggal
            <input type="date" value={f.from} onChange={(e) => set({ from: e.target.value })} />
          </label>
          <label className="f">
            Sampai tanggal
            <input type="date" value={f.to} onChange={(e) => set({ to: e.target.value })} />
          </label>
          <button className="btn pr" onClick={() => void exportCsv()}>
            Unduh CSV
          </button>
        </div>
      </div>

      <div className="card">
        {err ? <div className="chip err">{err}</div> : null}
        <div className="tbl">
          <table>
            <thead>
              <tr>
                <th>Waktu</th>
                <th>Order</th>
                <th>Paket</th>
                <th>Voucher</th>
                <th>Jumlah</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {(list?.data ?? []).map((t) => (
                <tr key={t.id} className="click" onClick={() => setOpen(t)}>
                  <td className="small">{dt(t.created_at)}</td>
                  <td className="mono">{t.midtrans_order_id}</td>
                  <td>{t.package?.name ?? '—'}</td>
                  <td>{t.voucher?.code ?? '—'}</td>
                  <td>{rp(t.amount)}</td>
                  <td>{statusChip(t.status)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {list && !list.data.length ? <p className="mu">Tidak ada transaksi.</p> : null}
        <Pager meta={list?.meta} onPage={(page) => setF((o) => ({ ...o, page }))} />
      </div>

      {open ? (
        <Modal title="Detail transaksi" onClose={() => setOpen(null)}>
          <table>
            <tbody>
              {(
                [
                  ['ID', <span className="mono">{open.id}</span>],
                  ['Order', <span className="mono">{open.midtrans_order_id}</span>],
                  ['Sesi', <a href={`#/sesi/${open.session_id}`}>{open.session_id}</a>],
                  ['Paket', open.package?.name ?? '—'],
                  ['Frame', open.frame?.name ?? '—'],
                  ['Voucher', open.voucher ? `${open.voucher.code} (−${rp(open.voucher.discount)})` : '—'],
                  ['Jumlah', rp(open.amount)],
                  ['Status', statusChip(open.status)],
                  ['Dibuat', dt(open.created_at)],
                  ['Dibayar', dt(open.paid_at)],
                ] as const
              ).map(([k, v]) => (
                <tr key={k}>
                  <th style={{ width: 120 }}>{k}</th>
                  <td>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Modal>
      ) : null}
    </div>
  );
}
