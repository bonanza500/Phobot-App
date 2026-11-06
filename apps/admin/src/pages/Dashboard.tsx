import { get, rp, dt } from '../api';
import { Delta, statusChip, usePoll } from '../ui';

interface Summary {
  kpis: { key: string; title: string; value: string; change_pct: number; change_label: string; trend: { label: string; value: number }[] }[];
  sales_report: { total: number; delta: number; data: { month: string; current: number; previous: number }[] };
  recent_orders: { id: string; package: string; amount: number; date: string; status: string }[];
  top_frames: { name: string; used: number }[];
  top_products: { name: string; used: number }[];
}

export function Dashboard() {
  const [d, , err] = usePoll<Summary>(() => get('/api/admin/dashboard/summary'), 30_000);
  if (err) return <div className="chip err">{err}</div>;
  if (!d) return <p className="mu">Memuat…</p>;
  const max = Math.max(1, ...d.sales_report.data.flatMap((m) => [m.current, m.previous]));

  return (
    <div className="grid">
      <h1>Dashboard</h1>
      <div className="grid g3">
        {d.kpis.map((k) => (
          <div key={k.key} className="card kpi">
            <div className="l">{k.title}</div>
            <div className="v">{k.value}</div>
            <div className="small">
              <Delta pct={k.change_pct} label={k.change_label} />
            </div>
            <Spark points={k.trend.map((t) => t.value)} />
          </div>
        ))}
      </div>

      <div className="card">
        <div className="row">
          <h2 style={{ margin: 0 }}>Penjualan per bulan</h2>
          <span className="spacer" />
          <b>{rp(d.sales_report.total)}</b>
          <span className="small">
            <Delta pct={d.sales_report.delta} label="vs tahun lalu" />
          </span>
        </div>
        <div className="bars" style={{ height: 160, marginTop: 14 }} aria-label="Grafik penjualan bulanan">
          {d.sales_report.data.map((m) => (
            <div key={m.month} title={`${m.month}: ${rp(m.current)} (tahun lalu ${rp(m.previous)})`} className="cur" style={{ height: `${(m.current / max) * 100}%` }} />
          ))}
        </div>
        <div className="row small mu" style={{ gap: 4, justifyContent: 'space-between' }}>
          {d.sales_report.data.map((m) => (
            <span key={m.month}>{m.month}</span>
          ))}
        </div>
      </div>

      <div className="grid g2">
        <div className="card">
          <h2>Order terbaru</h2>
          <div className="tbl">
            <table>
              <tbody>
                {d.recent_orders.map((o) => (
                  <tr key={o.id}>
                    <td>{o.package}</td>
                    <td>{rp(o.amount)}</td>
                    <td className="small mu">{dt(o.date)}</td>
                    <td>{statusChip(o.status)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <a className="small" href="#/laporan">
            Lihat semua transaksi →
          </a>
        </div>
        <TopList title="Paket terlaris" items={d.top_products} />
        <TopList title="Frame terpopuler" items={d.top_frames} />
      </div>
    </div>
  );
}

function TopList({ title, items }: { title: string; items: { name: string; used: number }[] }) {
  const max = Math.max(1, ...items.map((i) => i.used));
  return (
    <div className="card">
      <h2>{title}</h2>
      {items.length ? null : <p className="mu small">Belum ada data.</p>}
      {items.map((i) => (
        <div key={i.name} className="status-row">
          <span style={{ flex: 1 }}>{i.name}</span>
          <span style={{ width: 120, height: 8, background: 'var(--soft)', borderRadius: 4 }}>
            <span style={{ display: 'block', height: '100%', width: `${(i.used / max) * 100}%`, background: 'var(--bl)', borderRadius: 4 }} />
          </span>
          <b style={{ width: 40, textAlign: 'right' }}>{i.used}</b>
        </div>
      ))}
    </div>
  );
}

function Spark({ points }: { points: number[] }) {
  if (points.length < 2) return null;
  const max = Math.max(1, ...points);
  const d = points.map((v, i) => `${(i / (points.length - 1)) * 100},${30 - (v / max) * 28}`).join(' ');
  return (
    <svg viewBox="0 0 100 32" preserveAspectRatio="none" style={{ width: '100%', height: 32, marginTop: 6 }} aria-hidden>
      <polyline points={d} fill="none" stroke="var(--bl)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
