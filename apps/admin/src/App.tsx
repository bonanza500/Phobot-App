import { useEffect, useState } from 'react';
import { robotSvg } from '@photobooth/ui';
import { get, getToken, post, setToken, setUnauthorizedHandler } from './api';
import { Account } from './pages/Account';
import { AudioPage } from './pages/Audio';
import { Dashboard } from './pages/Dashboard';
import { Devices } from './pages/Devices';
import { Frames } from './pages/Frames';
import { Packages } from './pages/Packages';
import { Reports } from './pages/Reports';
import { Robot } from './pages/Robot';
import { Sessions } from './pages/Sessions';
import { Settings } from './pages/Settings';
import { Vouchers } from './pages/Vouchers';
import { Toasts } from './ui';

function useHashRoute() {
  const [hash, setHash] = useState(location.hash || '#/');
  useEffect(() => {
    const on = () => setHash(location.hash || '#/');
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return hash.replace(/^#/, '') || '/';
}

function Login({ onDone }: { onDone: (u: string) => void }) {
  const [email, setU] = useState('');
  const [password, setP] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      const r = await post<{ token: string; admin: { email: string } }>('/api/admin/login', { email, password });
      setToken(r.token);
      onDone(r.admin.email);
    } catch (ex) {
      setErr((ex as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="login">
      <form className="card" onSubmit={submit}>
        <div style={{ display: 'flex', justifyContent: 'center' }} dangerouslySetInnerHTML={{ __html: robotSvg('hi', 120) }} />
        <h1 style={{ textAlign: 'center', margin: 0 }}>Masuk Admin</h1>
        <p className="mu" style={{ textAlign: 'center', margin: 0 }}>
          Panel kontrol Robot Photobooth
        </p>
        <label className="f">
          Email
          <input type="email" value={email} onChange={(e) => setU(e.target.value)} autoComplete="username" required data-testid="login-user" />
        </label>
        <label className="f">
          Password
          <input type="password" value={password} onChange={(e) => setP(e.target.value)} autoComplete="current-password" required data-testid="login-pass" />
        </label>
        {err ? <div className="chip err" role="alert">{err}</div> : null}
        <button className="btn pr" disabled={busy} data-testid="login-submit">
          {busy ? 'Masuk…' : 'Masuk'}
        </button>
      </form>
    </div>
  );
}

const NAV: [string, string][] = [
  ['/', 'Dashboard'],
  ['/laporan', 'Laporan'],
  ['/sesi', 'Sesi'],
  ['/paket', 'Paket'],
  ['/frame', 'Frame'],
  ['/voucher', 'Voucher'],
  ['/audio', 'Audio'],
  ['/robot', 'Robot'],
  ['/pengaturan', 'Pengaturan'],
  ['/perangkat', 'Perangkat'],
  ['/akun', 'Akun'],
];

function Page({ route, user }: { route: string; user: string }) {
  const [, top, id] = route.split('/');
  switch (top) {
    case 'laporan':
      return <Reports />;
    case 'sesi':
      return <Sessions id={id ? decodeURIComponent(id) : undefined} />;
    case 'paket':
      return <Packages />;
    case 'frame':
      return <Frames />;
    case 'voucher':
      return <Vouchers />;
    case 'audio':
      return <AudioPage />;
    case 'robot':
      return <Robot />;
    case 'pengaturan':
      return <Settings />;
    case 'perangkat':
      return <Devices />;
    case 'akun':
      return <Account email={user} />;
    default:
      return <Dashboard />;
  }
}

export function App() {
  const route = useHashRoute();
  const [user, setUser] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setToken(null);
      setUser(null);
    });
    // Go has no session endpoint: a token that still opens a protected route is valid.
    if (!getToken()) return setUser(null);
    get('/api/admin/settings')
      .then(() => setUser(localStorage.getItem('pb.admin.email') ?? 'admin'))
      .catch(() => setUser(null));
  }, []);

  if (user === undefined) return null;
  if (!user)
    return (
      <Login
        onDone={(u) => {
          localStorage.setItem('pb.admin.email', u);
          setUser(u);
        }}
      />
    );

  const logout = () => {
    setToken(null);
    setUser(null);
  };

  return (
    <div className="layout">
      <aside className="side">
        <div className="brand">
          <span dangerouslySetInnerHTML={{ __html: robotSvg('hi', 44) }} />
          Robot
          <br />
          Photobooth
        </div>
        <nav className="nav">
          {NAV.map(([href, label]) => (
            <a key={href} href={`#${href}`} className={(href === '/' ? route === '/' : route.startsWith(href)) ? 'on' : ''}>
              {label}
            </a>
          ))}
        </nav>
        <div className="spacer" />
        <a className="small" href="/" target="_blank" rel="noreferrer">
          Buka booth ↗
        </a>
        <div className="small mu">Masuk sebagai {user}</div>
        <button className="btn" onClick={logout}>
          Keluar
        </button>
      </aside>
      <main>
        <Page key={route.split('/')[1]} route={route} user={user} />
      </main>
      <Toasts />
    </div>
  );
}
