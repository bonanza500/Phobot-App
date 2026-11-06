import { get } from '../api';
import { usePoll } from '../ui';

interface Base {
  id: string;
  status: string;
  lastActive: string;
  activeDuration: string;
  isOnline: boolean;
}
interface Devices {
  camera: Base & { resolution: string };
  printer: Base & {
    resolution: string;
    totalPrint: number;
    paperRemaining: number;
    paperTotal: number;
    ribbonRemaining: number;
    paperSize: string;
    paperType: string;
    isReady: boolean;
  };
  robot: Base;
}

export function Devices() {
  const [d, reload, err] = usePoll<Devices>(() => get('/api/admin/devices'), 10_000);
  return (
    <div className="grid">
      <div className="row">
        <h1 style={{ margin: 0 }}>Perangkat</h1>
        <span className="spacer" />
        <button className="btn" onClick={() => void reload()}>
          Tes ulang
        </button>
      </div>
      {err ? <div className="chip err">{err}</div> : null}
      {!d ? <p className="mu">Mengecek perangkat…</p> : null}
      {d ? (
        <div className="grid g3">
          <Card title="Kamera" dev={d.camera} rows={[['Resolusi', d.camera.resolution]]} />
          <Card
            title="Printer"
            dev={d.printer}
            rows={[
              ['Siap cetak', d.printer.isReady ? 'Ya' : 'Tidak'],
              ['Kertas', `${d.printer.paperRemaining} / ${d.printer.paperTotal}`],
              ['Ribbon', d.printer.ribbonRemaining],
              ['Ukuran / jenis', `${d.printer.paperSize || '—'} / ${d.printer.paperType || '—'}`],
              ['Total cetak', d.printer.totalPrint],
            ]}
          />
          <Card title="Robot" dev={d.robot} rows={[]} />
        </div>
      ) : null}
    </div>
  );
}

function Card({ title, dev, rows }: { title: string; dev: Base; rows: [string, React.ReactNode][] }) {
  return (
    <div className="card">
      <div className="row">
        <h2 style={{ margin: 0 }}>{title}</h2>
        <span className="spacer" />
        <span className={`chip ${dev.isOnline ? 'ok' : 'err'}`}>{dev.isOnline ? 'Online' : 'Offline'}</span>
      </div>
      <table style={{ marginTop: 10 }}>
        <tbody>
          {(
            [
              ['ID', dev.id || '—'],
              ['Status', dev.status],
              ['Terakhir aktif', dev.lastActive || '—'],
              ['Durasi aktif', dev.activeDuration || '—'],
              ...rows,
            ] as [string, React.ReactNode][]
          ).map(([k, v]) => (
            <tr key={k}>
              <th style={{ width: 130 }}>{k}</th>
              <td>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
