import { useEffect, useRef, useState } from 'react';
import { del, get, http, patch, post } from '../api';
import { toast, useAction, usePoll } from '../ui';

export interface AudioRow {
  id: string;
  tab: string;
  sort: number;
  trigger: string;
  script: string;
  tone: string;
  screenSeconds: number;
  source: 'booth' | 'admin' | 'unused';
  uploaded: boolean;
  uploadUrl?: string;
  hasDefault: boolean;
  defaultUrl?: string;
}

export const AUDIO_TABS: Record<string, string> = {
  welcome: 'Welcome',
  pay: 'Bayar',
  pay_free: 'Bayar gratis',
  package: 'Pilih paket',
  frame: 'Frame',
  capture: 'Bersiap & foto',
  review: 'Review',
  pick: 'Pilih foto',
  edit: 'Edit',
  final: 'Final & cetak',
  qr: 'QR & selesai',
  system: 'Sistem',
  unused: 'Tidak dipakai booth',
};

/** URL the booth plays: admin upload first, else the built-in clip. */
export const playUrl = (a: AudioRow) => (a.uploaded ? a.uploadUrl : a.hasDefault ? a.defaultUrl : undefined);
export const audioRecommendation = (a: Pick<AudioRow, 'uploaded' | 'hasDefault'>) => !a.uploaded && !a.hasDefault;

const durations = new Map<string, Promise<number>>();
/** Clip length in seconds (0 = missing / unreadable), cached per URL. */
export function clipDuration(url?: string): Promise<number> {
  if (!url) return Promise.resolve(0);
  if (!durations.has(url))
    durations.set(
      url,
      new Promise((done) => {
        const a = new Audio(url);
        a.preload = 'metadata';
        a.onloadedmetadata = () => done(Number.isFinite(a.duration) ? a.duration : 0);
        a.onerror = () => done(0);
      }),
    );
  return durations.get(url)!;
}

function useDuration(url?: string) {
  const [d, setD] = useState<number | null>(null);
  useEffect(() => {
    let on = true;
    setD(null);
    void clipDuration(url).then((v) => on && setD(v));
    return () => {
      on = false;
    };
  }, [url]);
  return d;
}

// ponytail: 0.3s tolerance for mp3 padding; make it a setting if admins need it stricter.
export const tooLong = (dur: number, screen: number) => screen > 0 && dur > screen + 0.3;

function status(a: AudioRow, dur: number | null) {
  if (!playUrl(a)) return <span className="chip err">Belum terpasang</span>;
  if (dur === null) return <span className="chip mu">…</span>;
  if (!dur) return <span className="chip err">File rusak</span>;
  if (tooLong(dur, a.screenSeconds)) return <span className="chip err">Terlalu panjang</span>;
  return <span className="chip ok">Terpasang</span>;
}

let player: HTMLAudioElement | null = null;
function playOnce(url: string) {
  player?.pause();
  player = new Audio(url);
  void player.play().catch(() => toast('Gagal memutar audio', true));
}

export function AudioPage() {
  const [res, reload, err] = usePoll<{ data: AudioRow[]; tabs: string[] }>(() => get('/api/admin/audio'));
  const [tab, setTab] = useState('welcome');
  const [newId, setNewId] = useState('');
  const [preview, setPreview] = useState(false);
  const { busy, run } = useAction();
  const rows = (res?.data ?? []).filter((a) => a.tab === tab);
  const tabs = res?.tabs ?? Object.keys(AUDIO_TABS);
  const recommendedCount = rows.filter((a) => a.source !== 'unused' && audioRecommendation(a)).length;

  const add = async () => {
    const ok = await run('add', () => post('/api/admin/audio', { id: newId.trim().toLowerCase(), tab }), 'Audio ditambahkan');
    if (ok) {
      setNewId('');
      await reload();
    }
  };

  const exportXlsx = async () => {
    const XLSX = await import('xlsx');
    const all = res?.data ?? [];
    const lens = await Promise.all(all.map((a) => clipDuration(playUrl(a))));
    const sheet = XLSX.utils.json_to_sheet(
      all.map((a, i) => ({
        Halaman: AUDIO_TABS[a.tab] ?? a.tab,
        'Nama file': a.id + '.mp3',
        Pemicu: a.trigger,
        Naskah: a.script,
        Nada: a.tone,
        'Durasi layar (dtk)': a.screenSeconds,
        'Durasi audio (dtk)': lens[i] ? Number(lens[i].toFixed(1)) : '',
        Sumber: a.uploaded ? 'Upload admin' : a.hasDefault ? 'Bawaan' : '',
        Status: !playUrl(a) ? 'Belum terpasang' : tooLong(lens[i], a.screenSeconds) ? 'Terlalu panjang' : 'Terpasang',
      })),
    );
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet, 'Master script');
    XLSX.writeFile(wb, 'master-script-audio.xlsx');
  };

  return (
    <div className="grid">
      <div className="row">
        <h1 style={{ margin: 0 }}>Audio</h1>
        <span className="spacer" />
        {recommendedCount > 0 ? <span className="chip warn">{recommendedCount} rekomendasi pasang</span> : null}
        <button className="btn pr" onClick={() => setPreview(true)} disabled={!res}>Pratinjau otomatis</button>
        <button className="btn" onClick={() => void exportXlsx()} disabled={!res}>
          Unduh Excel
        </button>
      </div>
      <p className="mu small" style={{ margin: 0 }}>
        File yang di-upload otomatis diberi nama <span className="mono">&lt;id&gt;.mp3</span> dan langsung dipakai booth mulai sesi berikutnya. Lepas file = booth kembali ke audio bawaan.
      </p>
      <div className="btns" role="tablist">
        {tabs.map((t) => {
          const list = (res?.data ?? []).filter((a) => a.tab === t);
          const missing = list.filter((a) => t !== 'unused' && !playUrl(a)).length;
          return (
            <button key={t} role="tab" aria-selected={t === tab} className={`btn ${t === tab ? 'pr' : ''}`} onClick={() => setTab(t)}>
              {AUDIO_TABS[t] ?? t}
              {missing && t !== 'unused' ? <span className="chip err">{missing} belum ada</span> : null}
              {list.filter((a) => a.source !== 'unused' && audioRecommendation(a)).length > 0 && t !== 'unused' ? <span className="chip warn">{list.filter((a) => a.source !== 'unused' && audioRecommendation(a)).length} rekomendasi</span> : null}
            </button>
          );
        })}
      </div>
      {err ? <div className="chip err">{err}</div> : null}
      <div className="card">
        {tab === 'unused' ? <p className="mu small">File di bawah tidak dipanggil kode booth. Boleh dibiarkan; tidak diputar.</p> : null}
        {recommendedCount > 0 ? <p className="small" style={{ color: '#8a5a00', background: '#fff6da', padding: '10px 14px', borderRadius: 12 }}><b>Rekomendasi pasang:</b> {rows.filter(audioRecommendation).map((a) => a.id).join(', ')}. Klip ini tidak punya upload atau audio bawaan; booth akan diam saat pemicunya berjalan.</p> : null}
        <div className="tbl">
          <table>
            <thead>
              <tr>
                <th>ID / pemicu</th>
                <th style={{ width: '38%' }}>Naskah & nada</th>
                <th>Durasi layar</th>
                <th>Durasi audio</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <Row key={a.id} a={a} reload={reload} />
              ))}
              {res && !rows.length ? (
                <tr>
                  <td colSpan={6} className="mu">
                    Belum ada audio di tab ini.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        {tab !== 'unused' ? (
          <form
            className="row"
            style={{ marginTop: 12 }}
            onSubmit={(e) => {
              e.preventDefault();
              void add();
            }}
          >
            <input style={{ width: 260 }} placeholder="id_audio_baru" value={newId} onChange={(e) => setNewId(e.target.value)} pattern="[a-z0-9_]{1,40}" aria-label="ID audio baru" />
            <button className="btn" disabled={!newId.trim() || busy !== null}>
              + Audio baru
            </button>
            <span className="small mu">Audio baru hanya naskah sampai ada pemicunya di kode booth.</span>
          </form>
        ) : null}
      </div>
      {preview ? <AudioPreview rows={res?.data ?? []} initialTab={tab} onClose={() => setPreview(false)} /> : null}
    </div>
  );
}

function AudioPreview({ rows, initialTab, onClose }: { rows: AudioRow[]; initialTab: string; onClose: () => void }) {
  const tabs = Object.keys(AUDIO_TABS).filter((t) => t !== 'unused');
  const [tab, setTab] = useState(initialTab === 'unused' ? 'welcome' : initialTab);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const player = useRef<HTMLAudioElement | null>(null);
  const list = rows.filter((a) => a.tab === tab);
  const item = list[index];
  const url = item && playUrl(item);
  const duration = item?.screenSeconds || 6;

  useEffect(() => {
    setIndex(0);
    setPlaying(true);
  }, [tab]);

  useEffect(() => {
    if (!item) return;
    const audio = player.current;
    if (audio) {
      audio.pause();
      audio.onended = null;
      audio.onerror = null;
      audio.removeAttribute('src');
      audio.load();
    }
    let live = true;
    if (playing && url && audio) {
      audio.src = url;
      audio.currentTime = 0;
      audio.onended = () => live && setIndex((i) => (i + 1) % list.length);
      audio.onerror = () => live && setIndex((i) => (i + 1) % list.length);
      void audio.play().catch(() => live && setIndex((i) => (i + 1) % list.length));
    } else if (playing) {
      const timer = window.setTimeout(() => live && setIndex((i) => (i + 1) % list.length), duration * 1000);
      return () => { live = false; clearTimeout(timer); };
    }
    return () => { live = false; };
  }, [item?.id, playing, tab]);

  useEffect(() => () => player.current?.pause(), []);

  if (!item) return null;
  const start = (n: number) => {
    player.current?.pause();
    setIndex((n + list.length) % list.length);
    setPlaying(true);
  };

  return (
    <div role="dialog" aria-modal="true" aria-label="Pratinjau audio booth" style={{ position: 'fixed', inset: 0, zIndex: 1000, background: '#171629', color: 'white', display: 'grid', gridTemplateRows: 'auto 1fr auto', padding: 24 }}>
      <audio ref={player} />
      <div className="row"><b>Pratinjau penuh · {AUDIO_TABS[tab]}</b><span className="spacer" /><button className="btn" onClick={onClose}>Tutup</button></div>
      <div style={{ alignSelf: 'center', justifySelf: 'center', textAlign: 'center', maxWidth: 1100 }}>
        <div style={{ fontSize: 20, opacity: 0.65 }}>{index + 1} / {list.length} · {item.id}</div>
        <div style={{ fontSize: 48, fontWeight: 700, margin: '20px 0' }}>{item.script || item.trigger || 'Naskah kosong'}</div>
        <div style={{ fontSize: 22, opacity: 0.7 }}>{item.tone}</div>
        {!url ? <div style={{ marginTop: 24, fontSize: 20 }}>Audio belum terpasang · tunggu {duration} dtk</div> : null}
      </div>
      <div>
        <div className="btns" style={{ justifyContent: 'center', marginBottom: 14 }}>
          <button className="btn" onClick={() => start(index - 1)}>Sebelumnya</button>
          <button className="btn pr" onClick={() => setPlaying((p) => !p)}>{playing ? 'Jeda' : 'Putar'}</button>
          <button className="btn" onClick={() => start(index)}>Ulang</button>
          <button className="btn" onClick={() => start(index + 1)}>Lompat</button>
          <button className="btn" onClick={() => setExpanded((v) => !v)}>{expanded ? 'Sembunyikan langkah' : 'Langkah'}</button>
        </div>
        {expanded ? <div style={{ maxHeight: 180, overflow: 'auto', background: '#26243d', borderRadius: 12, padding: 10 }}>
          {tabs.map((t) => <button key={t} className="btn" style={{ margin: 4 }} onClick={() => setTab(t)}>{AUDIO_TABS[t]}</button>)}
          <ol>{list.map((a, i) => <li key={a.id} aria-current={i === index ? 'step' : undefined}><button className="btn" onClick={() => start(i)}>{a.script || a.id} · {a.id}</button></li>)}</ol>
        </div> : null}
      </div>
    </div>
  );
}

function Row({ a, reload }: { a: AudioRow; reload: () => Promise<void> }) {
  const url = playUrl(a);
  const dur = useDuration(url);
  const [d, setD] = useState({ script: a.script, tone: a.tone, trigger: a.trigger, screenSeconds: String(a.screenSeconds) });
  const file = useRef<HTMLInputElement>(null);
  const { busy, run } = useAction();
  useEffect(() => setD({ script: a.script, tone: a.tone, trigger: a.trigger, screenSeconds: String(a.screenSeconds) }), [a]);

  const save = async (k: keyof typeof d) => {
    const v = k === 'screenSeconds' ? Number(d[k]) : d[k];
    if (v === a[k]) return;
    if (k === 'screenSeconds' && (!Number.isFinite(v as number) || (v as number) < 0 || (v as number) > 600)) return toast('Durasi layar 0–600 detik', true);
    if (await run('save', () => patch(`/api/admin/audio/${a.id}`, { [k]: v }), 'Tersimpan')) await reload();
  };
  const upload = async (f?: File) => {
    if (!f) return;
    const fd = new FormData();
    fd.append('file', f);
    if (await run('up', () => http('POST', `/api/admin/audio/${a.id}/file`, fd), `${a.id}.mp3 terpasang`)) await reload();
    if (file.current) file.current.value = '';
  };
  const detach = async () => {
    if (!confirm(`Lepas ${a.id}.mp3? Booth kembali ke audio bawaan${a.hasDefault ? '' : ' (tidak ada — clip jadi diam)'}.`)) return;
    if (await run('det', () => del(`/api/admin/audio/${a.id}/file`), 'File dilepas')) await reload();
  };
  const remove = async () => {
    if (!confirm(`Hapus audio ${a.id} beserta naskahnya?`)) return;
    if (await run('rm', () => del(`/api/admin/audio/${a.id}`), 'Audio dihapus')) await reload();
  };
  const field = (k: keyof typeof d) => ({ value: d[k], onChange: (e: { target: { value: string } }) => setD({ ...d, [k]: e.target.value }), onBlur: () => void save(k) });

  return (
    <tr>
      <td>
        <div className="mono">{a.id}</div>
        <input className="small" {...field('trigger')} placeholder="Kapan diputar" aria-label={`Pemicu ${a.id}`} style={{ marginTop: 4 }} />
      </td>
      <td>
        <textarea {...field('script')} placeholder="Naskah belum diisi" aria-label={`Naskah ${a.id}`} style={{ minHeight: 64, fontFamily: 'inherit', fontSize: 14 }} />
        <input className="small" {...field('tone')} placeholder="Nada / arahan suara" aria-label={`Nada ${a.id}`} style={{ marginTop: 4 }} />
      </td>
      <td>
        <input type="number" min={0} max={600} step={0.5} {...field('screenSeconds')} style={{ width: 90 }} aria-label={`Durasi layar ${a.id}`} />
        <div className="small mu">rekomendasi ≤ {a.screenSeconds || '–'} dtk</div>
      </td>
      <td>
        {url ? (dur === null ? '…' : dur ? `${dur.toFixed(1)} dtk` : '—') : '—'}
        <div className="small mu">{a.uploaded ? 'Upload admin' : a.hasDefault ? 'Bawaan' : ''}</div>
      </td>
      <td>{status(a, dur)}</td>
      <td>
        <div className="btns">
          {a.source !== 'unused' && audioRecommendation(a) ? <span className="chip warn" title="Tidak ada upload atau audio bawaan">Rekomendasi pasang</span> : null}
          <button className="btn" disabled={!url} onClick={() => url && playOnce(url)} aria-label={`Putar ${a.id}`}>
            ▶
          </button>
          <button className="btn" disabled={busy !== null} onClick={() => file.current?.click()}>
            {a.uploaded ? 'Ganti' : 'Upload'}
          </button>
          <input ref={file} type="file" accept="audio/mpeg,.mp3" hidden onChange={(e) => void upload(e.target.files?.[0])} />
          {a.uploaded ? (
            <button className="btn er" disabled={busy !== null} onClick={() => void detach()}>
              Lepas
            </button>
          ) : null}
          {a.source === 'admin' ? (
            <button className="btn er" disabled={busy !== null} onClick={() => void remove()}>
              Hapus
            </button>
          ) : null}
        </div>
      </td>
    </tr>
  );
}
