import { useState } from 'react';
import { del, dt, get, patch, post, qs, rp, type Page } from '../api';
import { Modal, Pager, Stat, toast, useAction, usePoll } from '../ui';

interface Voucher {
  code: string;
  description: string;
  discount_type: 'percentage' | 'fixed';
  discount_value: number;
  min_price: number;
  max_uses: number;
  used_count: number;
  is_active: boolean;
  expires_at?: string;
  created_at: string;
}

const expired = (v: Voucher) => !!v.expires_at && new Date(v.expires_at) < new Date();

export function Vouchers() {
  const [f, setF] = useState({ search: '', status: '', page: 1 });
  const [list, reloadList, err] = usePoll<Page<Voucher>>(() => get(`/api/admin/vouchers?${qs({ ...f, limit: 20 })}`), 0, [JSON.stringify(f)]);
  const [stats, reloadStats] = usePoll<{ total: number; active: number; inactive: number; expired: number; totalUsed: number }>(() => get('/api/admin/vouchers/stats'));
  const [edit, setEdit] = useState<Voucher | 'new' | null>(null);
  const [settings, reloadSettings] = usePoll<{ voucherChipEnabled: boolean; voucherChipCode: string }>(() => get('/api/admin/settings'));
  const [all, reloadAll] = usePoll<Page<Voucher>>(() => get('/api/admin/vouchers?limit=100'));
  const { busy, run } = useAction();
  const set = (p: Partial<typeof f>) => setF((o) => ({ ...o, page: 1, ...p }));
  const reload = () => Promise.all([reloadList(), reloadStats()]);
  const saveChip = async (value: Partial<{ voucherChipEnabled: boolean; voucherChipCode: string }>) => {
    try {
      await patch('/api/admin/settings', value);
      toast('Chip voucher disimpan');
      await reloadSettings();
    } catch (e) {
      toast((e as Error).message, true);
    }
  };

  const toggle = async (v: Voucher) => {
    await run('toggle', () => patch(`/api/admin/vouchers/${encodeURIComponent(v.code)}`, { isActive: !v.is_active }), v.is_active ? 'Voucher dinonaktifkan' : 'Voucher diaktifkan');
    await reload();
  };
  const remove = async (v: Voucher) => {
    if (!confirm(`Hapus voucher ${v.code}?`)) return;
    await run('del', () => del(`/api/admin/vouchers/${encodeURIComponent(v.code)}`), 'Voucher dihapus');
    await reload();
  };

  return (
    <div className="grid">
      <h1>Voucher</h1>
      <div className="card grid">
        <div className="row"><h2 style={{ margin: 0 }}>Chip voucher booth</h2><span className={`chip ${settings?.voucherChipEnabled ? 'ok' : 'mu'}`}>{settings ? (settings.voucherChipEnabled ? 'Aktif' : 'Tersembunyi') : '…'}</span></div>
        <p className="mu small" style={{ margin: 0 }}>Pilih voucher yang tampil sebagai tombol pintas di layar bayar. Diskon sebagian tetap lanjut ke QRIS untuk sisa pembayaran.</p>
        <div className="form" style={{ alignItems: 'end' }}>
          <label className="f">Kode chip
            <select value={settings?.voucherChipCode ?? ''} disabled={!settings || busy !== null} onChange={(e) => void saveChip({ voucherChipCode: e.target.value })}>
              {!all?.data.some((v) => v.code === settings?.voucherChipCode) && settings?.voucherChipCode ? <option value={settings.voucherChipCode}>{settings.voucherChipCode} (tidak tersedia)</option> : null}
              {(all?.data ?? []).map((v) => <option key={v.code} value={v.code}>{v.code} — {v.discount_type === 'percentage' ? `${v.discount_value}%` : rp(v.discount_value)} · {v.is_active && !expired(v) && v.used_count < v.max_uses ? 'Aktif' : 'tidak dapat dipakai'}</option>)}
            </select>
          </label>
          <label className="chk"><input type="checkbox" checked={!!settings?.voucherChipEnabled} disabled={!settings || busy !== null} onChange={(e) => void saveChip({ voucherChipEnabled: e.target.checked })} />Tampilkan chip di layar bayar</label>
          <button className="btn" type="button" onClick={() => void reloadAll()}>Muat ulang voucher</button>
        </div>
      </div>
      {stats ? (
        <div className="grid g6">
          <Stat label="Total" value={stats.total} />
          <Stat label="Aktif" value={stats.active} />
          <Stat label="Nonaktif" value={stats.inactive} />
          <Stat label="Kedaluwarsa" value={stats.expired} />
          <Stat label="Total dipakai" value={stats.totalUsed} />
        </div>
      ) : null}
      <div className="card">
        <div className="form" style={{ alignItems: 'end' }}>
          <label className="f">
            Cari kode
            <input value={f.search} onChange={(e) => set({ search: e.target.value })} />
          </label>
          <label className="f">
            Status
            <select value={f.status} onChange={(e) => set({ status: e.target.value })}>
              <option value="">Semua</option>
              <option value="active">Aktif</option>
              <option value="inactive">Nonaktif</option>
              <option value="expired">Kedaluwarsa</option>
            </select>
          </label>
          <button className="btn pr" onClick={() => setEdit('new')}>
            + Voucher baru
          </button>
        </div>
      </div>
      <div className="card">
        {err ? <div className="chip err">{err}</div> : null}
        <div className="tbl">
          <table>
            <thead>
              <tr>
                <th>Kode</th>
                <th>Diskon</th>
                <th>Min. harga</th>
                <th>Dipakai</th>
                <th>Berlaku sampai</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(list?.data ?? []).map((v) => (
                <tr key={v.code}>
                  <td>
                    <b className="mono">{v.code}</b>
                    <div className="small mu">{v.description}</div>
                  </td>
                  <td>{v.discount_type === 'percentage' ? `${v.discount_value}%` : rp(v.discount_value)}</td>
                  <td>{rp(v.min_price)}</td>
                  <td>
                    {v.used_count} / {v.max_uses}
                  </td>
                  <td className="small">{v.expires_at ? dt(v.expires_at) : 'Tanpa batas'}</td>
                  <td>
                    {expired(v) ? <span className="chip err">Kedaluwarsa</span> : v.is_active ? <span className="chip ok">Aktif</span> : <span className="chip mu">Nonaktif</span>}
                  </td>
                  <td>
                    <div className="btns">
                      <button className="btn" disabled={busy !== null} onClick={() => void toggle(v)}>
                        {v.is_active ? 'Nonaktifkan' : 'Aktifkan'}
                      </button>
                      <button className="btn" onClick={() => setEdit(v)}>
                        Ubah
                      </button>
                      <button className="btn er" disabled={busy !== null} onClick={() => void remove(v)}>
                        Hapus
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pager meta={list?.meta} onPage={(page) => setF((o) => ({ ...o, page }))} />
      </div>
      {edit ? <VoucherForm v={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onSaved={reload} /> : null}
    </div>
  );
}

function VoucherForm({ v, onClose, onSaved }: { v: Voucher | null; onClose: () => void; onSaved: () => Promise<unknown> }) {
  const [x, setX] = useState({
    code: v?.code ?? '',
    description: v?.description ?? '',
    discountType: v?.discount_type ?? 'percentage',
    discountValue: String(v?.discount_value ?? 10),
    minPrice: String(v?.min_price ?? 0),
    maxUses: String(v?.max_uses ?? 100),
    isActive: v?.is_active ?? true,
    expiresAt: v?.expires_at ? v.expires_at.slice(0, 10) : '',
  });
  const [saving, setSaving] = useState(false);
  const set = (o: Partial<typeof x>) => setX((p) => ({ ...p, ...o }));
  const val = Number(x.discountValue);
  const valid = x.code.trim() && val > 0 && (x.discountType !== 'percentage' || val <= 100) && Number(x.maxUses) >= 1;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = {
      ...(v ? {} : { code: x.code.trim().toUpperCase() }),
      description: x.description,
      discountType: x.discountType,
      discountValue: val,
      minPrice: Number(x.minPrice) || 0,
      maxUses: Number(x.maxUses),
      isActive: x.isActive,
      // End of the chosen day, local time.
      expiresAt: x.expiresAt ? new Date(`${x.expiresAt}T23:59:59`).toISOString() : '',
    };
    setSaving(true);
    try {
      if (v) await patch(`/api/admin/vouchers/${encodeURIComponent(v.code)}`, body);
      else await post('/api/admin/vouchers', body);
      toast('Voucher disimpan');
      await onSaved();
      onClose();
    } catch (ex) {
      toast((ex as Error).message, true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={v ? `Ubah ${v.code}` : 'Voucher baru'} onClose={onClose}>
      <form className="grid" onSubmit={save}>
        <div className="form">
          <label className="f">
            Kode
            <input value={x.code} disabled={!!v} onChange={(e) => set({ code: e.target.value.toUpperCase() })} required />
          </label>
          <label className="f">
            Jenis diskon
            <select value={x.discountType} onChange={(e) => set({ discountType: e.target.value as Voucher['discount_type'] })}>
              <option value="percentage">Persen (%)</option>
              <option value="fixed">Nominal (Rp)</option>
            </select>
          </label>
          <label className="f">
            Nilai diskon
            <input type="number" min={1} max={x.discountType === 'percentage' ? 100 : undefined} value={x.discountValue} onChange={(e) => set({ discountValue: e.target.value })} />
          </label>
          <label className="f">
            Minimal harga (Rp)
            <input type="number" min={0} value={x.minPrice} onChange={(e) => set({ minPrice: e.target.value })} />
          </label>
          <label className="f">
            Kuota pemakaian
            <input type="number" min={1} value={x.maxUses} onChange={(e) => set({ maxUses: e.target.value })} />
          </label>
          <label className="f">
            Berlaku sampai (kosong = tanpa batas)
            <input type="date" value={x.expiresAt} onChange={(e) => set({ expiresAt: e.target.value })} />
          </label>
        </div>
        <label className="f">
          Deskripsi
          <input value={x.description} onChange={(e) => set({ description: e.target.value })} />
        </label>
        <label className="chk">
          <input type="checkbox" checked={x.isActive} onChange={(e) => set({ isActive: e.target.checked })} />
          Aktif
        </label>
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
