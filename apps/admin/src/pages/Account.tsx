import { useState } from 'react';
import { post } from '../api';
import { toast } from '../ui';

export function Account({ email }: { email: string }) {
  const [v, setV] = useState({ oldPassword: '', newPassword: '', confirm: '' });
  const [saving, setSaving] = useState(false);
  const mismatch = v.confirm !== '' && v.confirm !== v.newPassword;
  const valid = v.oldPassword && v.newPassword.length >= 8 && v.newPassword === v.confirm;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await post('/api/admin/password', { oldPassword: v.oldPassword, newPassword: v.newPassword });
      toast('Password diganti');
      setV({ oldPassword: '', newPassword: '', confirm: '' });
    } catch (ex) {
      toast((ex as Error).message, true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid">
      <h1>Akun</h1>
      <div className="card" style={{ maxWidth: 460 }}>
        <h2>Ganti password</h2>
        <p className="mu small">Login sebagai {email}. Ganti password bawaan sebelum booth dipakai publik.</p>
        <form className="grid" onSubmit={save}>
          <label className="f">
            Password lama
            <input type="password" autoComplete="current-password" value={v.oldPassword} onChange={(e) => setV({ ...v, oldPassword: e.target.value })} required />
          </label>
          <label className="f">
            Password baru (min. 8 karakter)
            <input type="password" autoComplete="new-password" minLength={8} value={v.newPassword} onChange={(e) => setV({ ...v, newPassword: e.target.value })} required />
          </label>
          <label className="f">
            Ulangi password baru
            <input type="password" autoComplete="new-password" value={v.confirm} onChange={(e) => setV({ ...v, confirm: e.target.value })} aria-invalid={mismatch} required />
            {mismatch ? <span className="chip err">Password tidak sama</span> : null}
          </label>
          <div className="btns">
            <button className="btn pr" disabled={!valid || saving}>
              {saving ? 'Menyimpan…' : 'Simpan password'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
