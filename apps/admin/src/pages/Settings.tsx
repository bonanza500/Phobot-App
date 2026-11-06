import { useEffect, useState } from 'react';
import { del, get, patch } from '../api';
import { toast, usePoll } from '../ui';

// text = true: min/max are character counts, value saved as string.
type Field = [key: string, label: string, min: number, max: number, step?: number, unit?: string, text?: boolean];

// Ranges mirror backend validation (config.go timerFields/sessionFields/displayFields, robot_settings.go robotRanges).
const SESSION: Field[] = [
  ['readySeconds', 'Hitung mundur bila audio countdown tidak ada', 1, 30, 1, 'detik'],
  ['retakeLimit', 'Batas foto ulang per sesi', 0, 20, 1, 'kali'],
  ['maxQuantity', 'Maks jumlah cetak', 1, 50, 1, 'lembar'],
];
const DISPLAY: Field[] = [
  ['brandLabel', 'Label di frame', 1, 40, undefined, undefined, true],
  ['welcomeChip', 'Teks chip layar awal', 1, 80, undefined, undefined, true],
];
const TIMERS: Field[] = [
  ['paymentSeconds', 'Halaman bayar (QRIS)', 30, 3600, 1, 'detik'],
  ['selectionSeconds', 'Review foto', 15, 3600, 1, 'detik'],
  ['frameSeconds', 'Pilih frame', 15, 3600, 1, 'detik'],
  ['pickSeconds', 'Pilih foto per slot', 15, 3600, 1, 'detik'],
  ['editingSeconds', 'Edit foto', 15, 3600, 1, 'detik'],
  ['finalSeconds', 'Preview akhir', 15, 3600, 1, 'detik'],
  ['qrSeconds', 'QR unduh', 10, 3600, 1, 'detik'],
  ['thanksSeconds', 'Terima kasih', 3, 600, 1, 'detik'],
  ['warningSeconds', 'Peringatan sebelum habis', 3, 120, 1, 'detik'],
  ['errorResetSeconds', 'Reset layar error', 10, 3600, 1, 'detik'],
];
// Only what jona-bridge uses (scripts/jona-bridge.ts applyTuning). Jona's speed is set in its firmware;
// the Dobot speed/acceleration and face-tracking keys still exist in Go but do nothing on this arm.
const ROBOT: Field[] = [
  ['sequenceSlotSec', 'Durasi per pose', 5, 120, 1, 'detik'],
  ['postActionDelay', 'Jeda setelah jepret', 0, 5, 0.1, 'detik'],
];

export function Settings() {
  return (
    <div className="grid">
      <h1>Pengaturan</h1>
      <Section
        title="Timer layar booth"
        hint="Batas waktu tiap layar sebelum booth lanjut/kembali otomatis. Berlaku saat booth kembali ke layar awal."
        path="/api/admin/settings"
        nest="timeouts"
        fields={TIMERS}
      />
      <Section
        title="Sesi foto"
        hint="Berlaku untuk sesi baru setelah booth kembali ke layar awal."
        path="/api/admin/settings"
        nest="session"
        fields={SESSION}
      />
      <Section
        title="Tampilan booth"
        hint="Angka “10 angle” di chip otomatis disesuaikan. Berlaku saat booth kembali ke layar awal."
        path="/api/admin/settings"
        nest="display"
        fields={DISPLAY}
      />
      <Section
        title="Robot"
        hint="Langsung dikirim ke jona-bridge (tanpa restart), berlaku mulai pose berikutnya. Biasanya jepret dimulai begitu narasi pose selesai; durasi per pose adalah batas maksimalnya. Pose dan urutannya diatur di menu Robot."
        path="/api/admin/robot-settings"
        fields={ROBOT}
      />
    </div>
  );
}

function Section({ title, hint, path, nest, fields }: { title: string; hint: string; path: string; nest?: string; fields: Field[] }) {
  const [raw, reload, err] = usePoll<Record<string, any>>(() => get(path));
  const data: Record<string, number | string> | null = raw ? (nest ? raw[nest] : raw) : null;
  const [v, setV] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const fill = (d: Record<string, number | string>) => setV(Object.fromEntries(fields.map(([k]) => [k, String(d[k] ?? '')])));
  useEffect(() => {
    if (data) fill(data);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raw]);

  const val = ([k, , , , , , text]: Field) => (text ? v[k]?.trim() : Number(v[k]));
  const bad = fields.filter(([k, , min, max, , , text]) => {
    if (text) return (v[k]?.trim().length ?? 0) < min || (v[k]?.trim().length ?? 0) > max;
    const n = Number(v[k]);
    return v[k] === '' || Number.isNaN(n) || n < min || n > max;
  });
  const changed = data ? fields.filter((f) => val(f) !== data[f[0]]) : [];

  const send = async (fn: () => Promise<unknown>, ok: string) => {
    setSaving(true);
    try {
      await fn();
      toast(ok);
      await reload();
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setSaving(false);
    }
  };
  const save = () => {
    const body = Object.fromEntries(changed.map((f) => [f[0], val(f)]));
    return send(() => patch(path, nest ? { [nest]: body } : body), `${title} disimpan`);
  };
  const reset = () =>
    confirm(`Kembalikan semua ${title.toLowerCase()} ke nilai bawaan?`) && void send(() => del(nest ? `${path}?group=${nest}` : path), `${title} kembali ke bawaan`);

  return (
    <div className="card">
      <h2>{title}</h2>
      <p className="mu small">{hint}</p>
      {err ? <div className="chip err">{err}</div> : null}
      <div className="form">
        {fields.map(([k, label, min, max, step, unit, text]) => (
          <label key={k} className="f">
            {label} {unit ? `(${unit})` : ''}
            <input
              type={text ? 'text' : 'number'}
              min={text ? undefined : min}
              max={text ? undefined : max}
              maxLength={text ? max : undefined}
              step={step}
              value={v[k] ?? ''}
              onChange={(e) => setV((o) => ({ ...o, [k]: e.target.value }))}
              aria-invalid={bad.some(([b]) => b === k)}
              style={bad.some(([b]) => b === k) ? { borderColor: 'var(--er)' } : undefined}
            />
            <span className="small">{text ? `maks ${max} karakter` : `${min}–${max}`}</span>
          </label>
        ))}
      </div>
      <div className="btns" style={{ marginTop: 14 }}>
        <button className="btn pr" disabled={!data || saving || bad.length > 0 || changed.length === 0} onClick={() => void save()}>
          {saving ? 'Menyimpan…' : 'Simpan'}
        </button>
        <button className="btn" disabled={!data || changed.length === 0} onClick={() => data && fill(data)}>
          Batalkan perubahan
        </button>
        <button className="btn" disabled={!data || saving} onClick={reset}>
          Kembalikan bawaan
        </button>
      </div>
    </div>
  );
}
