import { useState } from 'react';
import { del, get, http, media, patch, post, rp, type Page } from '../api';
import { Modal, Stat, statusChip, toast, useAction, usePoll } from '../ui';

interface Pkg {
  id: number;
  code: string;
  name: string;
  price: number;
  duration_secs: number;
  description: string;
  image_src: string;
  is_popular: boolean;
  print_count: number;
  print_unit_price: number;
  status: string;
}
interface Settings {
  freeMode: boolean;
  freeDigitalOnly: boolean;
}

/** Paket + Mode Gratis/Berbayar + saklar chip voucher. */
export function Packages() {
  const [list, reloadList, err] = usePoll<Page<Pkg>>(() => get('/api/admin/packages?limit=100'));
  const [settings, reloadSettings] = usePoll<Settings>(() => get('/api/admin/settings'));
  const [stats, reloadStats] = usePoll<{ active: number; inactive: number; soldToday: number; revenueToday: number }>(() => get('/api/admin/packages/stats'), 30_000);
  const [edit, setEdit] = useState<Pkg | 'new' | null>(null);
  const { busy, run } = useAction();
  const free = !!settings?.freeMode;
  const reload = () => Promise.all([reloadList(), reloadStats()]);

  const setFree = async (enabled: boolean) => {
    const ask = enabled
      ? 'Aktifkan Mode Gratis? Semua harga paket jadi Rp0 (harga sekarang disimpan).'
      : 'Kembali ke Mode Berbayar? Harga sebelum Mode Gratis dikembalikan.';
    if (!confirm(ask)) return;
    await run('free', () => post('/api/admin/free-mode', { enabled }), enabled ? 'Mode Gratis aktif' : 'Mode Berbayar aktif');
    await Promise.all([reload(), reloadSettings()]);
  };

  const setFreeOutput = async (digitalOnly: boolean) => {
    await run('free-output', () => patch('/api/admin/settings', { freeDigitalOnly: digitalOnly }), digitalOnly ? 'Mode gratis: digital saja' : 'Mode gratis: cetak + digital');
    await reloadSettings();
  };

  const remove = async (p: Pkg) => {
    if (!confirm(`Hapus paket "${p.name}"? Tidak bisa dibatalkan.`)) return;
    await run('del', () => del(`/api/admin/packages/${p.id}`), 'Paket dihapus');
    await reload();
  };

  return (
    <div className="grid">
      <h1>Paket</h1>
      {stats ? (
        <div className="grid g6">
          <Stat label="Aktif" value={stats.active} />
          <Stat label="Nonaktif" value={stats.inactive} />
          <Stat label="Terjual hari ini" value={stats.soldToday} />
          <Stat label="Pendapatan hari ini" value={rp(stats.revenueToday)} />
        </div>
      ) : null}

      <div className="grid g2">
        <div className="card">
          <div className="row">
            <h2 style={{ margin: 0 }}>Mode booth</h2>
            <span className={`chip ${free ? 'ok' : 'mu'}`}>{settings ? (free ? 'Gratis' : 'Berbayar') : '…'}</span>
          </div>
          <p className="mu small">Mode Gratis: booth menampilkan halaman gratis tanpa QRIS. Booth ikut berubah saat kembali ke layar awal.</p>
          <div className="btns">
            <button className="btn pr" disabled={!settings || free || busy !== null} onClick={() => void setFree(true)}>
              Mode Gratis
            </button>
            <button className="btn" disabled={!settings || !free || busy !== null} onClick={() => void setFree(false)}>
              Mode Berbayar
            </button>
          </div>
          <label className="f" style={{ marginTop: 16 }}>
            Hasil Mode Gratis
            <select value={settings?.freeDigitalOnly ? 'digital' : 'print'} disabled={!settings || !free || busy !== null} onChange={(e) => void setFreeOutput(e.target.value === 'digital')}>
              <option value="digital">Digital saja</option>
              <option value="print">1 cetak + digital</option>
            </select>
          </label>
        </div>
      </div>

      <div className="card">
        <div className="row">
          <h2 style={{ margin: 0 }}>Daftar paket</h2>
          <span className="spacer" />
          <button className="btn pr" onClick={() => setEdit('new')}>
            + Paket baru
          </button>
        </div>
        {err ? <div className="chip err">{err}</div> : null}
        {free ? <p className="mu small">Mode Gratis aktif: harga dikunci Rp0. Kembali ke Mode Berbayar dulu untuk mengubah harga.</p> : null}
        <div className="tbl">
          <table>
            <thead>
              <tr>
                <th />
                <th>Paket</th>
                <th>Harga</th>
                <th>Harga cetak / lembar</th>
                <th>Durasi</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(list?.data ?? []).map((p) => (
                <tr key={p.id}>
                  <td>{p.image_src ? <img className="thumb" src={media(p.image_src)} alt="" /> : null}</td>
                  <td>
                    <b>{p.name}</b> {p.is_popular ? <span className="chip warn">Populer</span> : null}
                    <div className="small mu">{p.code}</div>
                  </td>
                  <td>{rp(p.price)}</td>
                  <td>{rp(p.print_unit_price)}</td>
                  <td>{Math.round(p.duration_secs / 60)} menit</td>
                  <td>{statusChip(p.status)}</td>
                  <td>
                    <div className="btns">
                      <button className="btn" onClick={() => setEdit(p)}>
                        Ubah
                      </button>
                      <button className="btn er" disabled={busy !== null} onClick={() => void remove(p)}>
                        Hapus
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {edit ? <PkgForm p={edit === 'new' ? null : edit} priceLocked={free} onClose={() => setEdit(null)} onSaved={reload} /> : null}
    </div>
  );
}

function PkgForm({ p, priceLocked, onClose, onSaved }: { p: Pkg | null; priceLocked: boolean; onClose: () => void; onSaved: () => Promise<unknown> }) {
  const [v, setV] = useState({
    code: p?.code ?? '',
    name: p?.name ?? '',
    description: p?.description ?? '',
    price: String(p?.price ?? 0),
    print_unit_price: String(p?.print_unit_price ?? 0),
    duration_mins: String(Math.round((p?.duration_secs ?? 300) / 60)),
    status: p?.status ?? 'active',
    is_popular: p?.is_popular ?? false,
  });
  const [image, setImage] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const set = (o: Partial<typeof v>) => setV((x) => ({ ...x, ...o }));
  const valid = v.code.trim() && v.name.trim() && /^\d+$/.test(v.price) && /^\d+$/.test(v.print_unit_price) && Number(v.duration_mins) >= 1;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const f = new FormData();
    f.set('code', v.code.trim());
    f.set('name', v.name.trim());
    f.set('description', v.description);
    if (!priceLocked) {
      f.set('price', v.price);
      f.set('print_unit_price', v.print_unit_price);
    }
    f.set('duration_secs', String(Number(v.duration_mins) * 60));
    f.set('status', v.status);
    f.set('is_popular', String(v.is_popular));
    if (image) f.set('image', image);
    setSaving(true);
    try {
      await http(p ? 'PATCH' : 'POST', p ? `/api/admin/packages/${p.id}` : '/api/admin/packages', f);
      toast('Paket disimpan');
      await onSaved();
      onClose();
    } catch (ex) {
      toast((ex as Error).message, true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={p ? `Ubah ${p.name}` : 'Paket baru'} onClose={onClose}>
      <form className="grid" onSubmit={save}>
        <div className="form">
          <label className="f">
            Nama
            <input value={v.name} onChange={(e) => set({ name: e.target.value })} required />
          </label>
          <label className="f">
            Kode
            <input value={v.code} onChange={(e) => set({ code: e.target.value })} required />
          </label>
          <label className="f">
            Harga (Rp)
            <input inputMode="numeric" value={v.price} disabled={priceLocked} onChange={(e) => set({ price: e.target.value.trim() })} />
          </label>
          <label className="f">
            Harga cetak / lembar (Rp)
            <input inputMode="numeric" value={v.print_unit_price} disabled={priceLocked} onChange={(e) => set({ print_unit_price: e.target.value.trim() })} />
          </label>
          <label className="f">
            Durasi (menit)
            <input type="number" min={1} value={v.duration_mins} onChange={(e) => set({ duration_mins: e.target.value })} />
          </label>
          <label className="f">
            Status
            <select value={v.status} onChange={(e) => set({ status: e.target.value })}>
              <option value="active">Aktif</option>
              <option value="inactive">Nonaktif</option>
            </select>
          </label>
        </div>
        <label className="f">
          Deskripsi
          <input value={v.description} onChange={(e) => set({ description: e.target.value })} />
        </label>
        <div className="form">
          <label className="f">
            Gambar
            <input type="file" accept="image/*" onChange={(e) => setImage(e.target.files?.[0] ?? null)} />
          </label>
          <label className="chk">
            <input type="checkbox" checked={v.is_popular} onChange={(e) => set({ is_popular: e.target.checked })} />
            Tandai populer
          </label>
        </div>
        {priceLocked ? <p className="mu small">Harga tidak bisa diubah selama Mode Gratis.</p> : null}
        <div className="btns">
          <button className="btn pr" disabled={!valid || saving}>
            {saving ? 'Menyimpan…' : 'Simpan'}
          </button>
          <button type="button" className="btn" onClick={onClose}>
            Batal
          </button>
        </div>
      </form>
    </Modal>
  );
}
