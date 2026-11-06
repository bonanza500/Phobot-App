import { useState } from 'react';
import { del, dt, get, http, media, qs, type Page } from '../api';
import { Modal, Pager, Stat, statusChip, toast, useAction, usePoll } from '../ui';

interface Frame {
  id: string;
  name: string;
  category: string;
  description: string;
  thumb_url: string;
  photo_slots: number;
  canvas_width: number;
  canvas_height: number;
  slots: unknown;
  status: string;
  used_count: number;
  used_today: number;
  last_used: string;
}

export function Frames() {
  const [f, setF] = useState({ search: '', status: '', category: '', page: 1 });
  const [list, reloadList, err] = usePoll<Page<Frame>>(() => get(`/api/admin/frames?${qs({ ...f, limit: 24 })}`), 0, [JSON.stringify(f)]);
  const [stats, reloadStats] = usePoll<{ total: number; active: number; inactive: number; usedToday: number }>(() => get('/api/admin/frames/stats'));
  const [edit, setEdit] = useState<Frame | 'new' | null>(null);
  const { busy, run } = useAction();
  const set = (p: Partial<typeof f>) => setF((o) => ({ ...o, page: 1, ...p }));
  const reload = () => Promise.all([reloadList(), reloadStats()]);

  const remove = async (fr: Frame) => {
    if (!confirm(`Hapus frame "${fr.name}"?`)) return;
    await run('del', () => del(`/api/admin/frames/${fr.id}`), 'Frame dihapus');
    await reload();
  };

  return (
    <div className="grid">
      <h1>Frame</h1>
      {stats ? (
        <div className="grid g6">
          <Stat label="Total" value={stats.total} />
          <Stat label="Aktif" value={stats.active} />
          <Stat label="Nonaktif" value={stats.inactive} />
          <Stat label="Dipakai hari ini" value={stats.usedToday} />
        </div>
      ) : null}
      <div className="card">
        <div className="form" style={{ alignItems: 'end' }}>
          <label className="f">
            Cari nama
            <input value={f.search} onChange={(e) => set({ search: e.target.value })} />
          </label>
          <label className="f">
            Kategori
            <select value={f.category} onChange={(e) => set({ category: e.target.value })}>
              <option value="">Semua</option>
              <option value="Personal">Personal</option>
              <option value="Group">Group</option>
            </select>
          </label>
          <label className="f">
            Status
            <select value={f.status} onChange={(e) => set({ status: e.target.value })}>
              <option value="">Semua</option>
              <option value="active">Aktif</option>
              <option value="inactive">Nonaktif</option>
            </select>
          </label>
          <button className="btn pr" onClick={() => setEdit('new')}>
            + Upload frame
          </button>
        </div>
      </div>
      <div className="card">
        {err ? <div className="chip err">{err}</div> : null}
        <div className="tbl">
          <table>
            <thead>
              <tr>
                <th />
                <th>Nama</th>
                <th>Kategori</th>
                <th>Slot</th>
                <th>Dipakai</th>
                <th>Terakhir</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(list?.data ?? []).map((fr) => (
                <tr key={fr.id}>
                  <td>{fr.thumb_url ? <img className="thumb" src={media(fr.thumb_url)} alt="" loading="lazy" /> : null}</td>
                  <td>
                    <b>{fr.name}</b>
                    <div className="small mu">{fr.id}</div>
                  </td>
                  <td>{fr.category}</td>
                  <td>{fr.photo_slots}</td>
                  <td>
                    {fr.used_count} <span className="small mu">({fr.used_today} hari ini)</span>
                  </td>
                  <td className="small">{fr.last_used ? dt(fr.last_used) : '—'}</td>
                  <td>{statusChip(fr.status)}</td>
                  <td>
                    <div className="btns">
                      <button className="btn" onClick={() => setEdit(fr)}>
                        Ubah
                      </button>
                      <button className="btn er" disabled={busy !== null} onClick={() => void remove(fr)}>
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
      {edit ? <FrameForm fr={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onSaved={reload} /> : null}
    </div>
  );
}

function FrameForm({ fr, onClose, onSaved }: { fr: Frame | null; onClose: () => void; onSaved: () => Promise<unknown> }) {
  const [v, setV] = useState({
    name: fr?.name ?? '',
    category: fr?.category ?? 'Personal',
    description: fr?.description ?? '',
    status: fr?.status ?? 'active',
    canvas_width: String(fr?.canvas_width ?? 464),
    canvas_height: String(fr?.canvas_height ?? 696),
    slots: JSON.stringify(fr?.slots ?? [], null, 2),
  });
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const set = (o: Partial<typeof v>) => setV((x) => ({ ...x, ...o }));
  let slotsOk = true;
  try {
    slotsOk = Array.isArray(JSON.parse(v.slots));
  } catch {
    slotsOk = false;
  }

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const f = new FormData();
    Object.entries(v).forEach(([k, val]) => f.set(k, val));
    if (file) f.set('file', file);
    setSaving(true);
    try {
      await http(fr ? 'PATCH' : 'POST', fr ? `/api/admin/frames/${fr.id}` : '/api/admin/frames', f);
      toast('Frame disimpan');
      await onSaved();
      onClose();
    } catch (ex) {
      toast((ex as Error).message, true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={fr ? `Ubah ${fr.name}` : 'Upload frame'} onClose={onClose}>
      <form className="grid" onSubmit={save}>
        <div className="form">
          <label className="f">
            Nama
            <input value={v.name} onChange={(e) => set({ name: e.target.value })} required />
          </label>
          <label className="f">
            Kategori
            <select value={v.category} onChange={(e) => set({ category: e.target.value })}>
              <option value="Personal">Personal (1–4 orang)</option>
              <option value="Group">Group</option>
            </select>
          </label>
          <label className="f">
            Status
            <select value={v.status} onChange={(e) => set({ status: e.target.value })}>
              <option value="active">Aktif</option>
              <option value="inactive">Nonaktif</option>
            </select>
          </label>
          <label className="f">
            Lebar canvas (px)
            <input type="number" min={1} value={v.canvas_width} onChange={(e) => set({ canvas_width: e.target.value })} />
          </label>
          <label className="f">
            Tinggi canvas (px)
            <input type="number" min={1} value={v.canvas_height} onChange={(e) => set({ canvas_height: e.target.value })} />
          </label>
          <label className="f">
            File frame (PNG/SVG){fr ? ' — kosongkan jika tidak diganti' : ''}
            <input type="file" accept="image/png,image/svg+xml,image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} required={!fr} />
          </label>
        </div>
        <label className="f">
          Deskripsi
          <input value={v.description} onChange={(e) => set({ description: e.target.value })} />
        </label>
        {/* ponytail: slot diedit sebagai JSON [{x,y,width,height}]; editor visual drag-drop kalau admin sering bikin frame. */}
        <label className="f">
          Slot foto (JSON: x, y, width, height per slot)
          <textarea value={v.slots} onChange={(e) => set({ slots: e.target.value })} style={{ minHeight: 160 }} />
          {slotsOk ? null : <span className="chip err">JSON slot tidak valid</span>}
        </label>
        <div className="btns">
          <button className="btn pr" disabled={!v.name.trim() || !slotsOk || saving}>
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
