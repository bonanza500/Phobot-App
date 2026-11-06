export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

// Go backend auth: JWT from /api/admin/login, sent as a Bearer header.
const TOKEN_KEY = 'pb.admin.token';
export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t: string | null) => (t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY));

export async function http<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const form = body instanceof FormData;
  const token = getToken();
  const headers: Record<string, string> = {};
  if (body !== undefined && !form) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(path, {
    method,
    headers,
    body: body === undefined ? undefined : form ? body : JSON.stringify(body),
  });
  if (res.status === 401 && !path.endsWith('/login')) onUnauthorized?.();
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { error: text };
  }
  // Go errors: {success:false, error:"..."}; Node-style {error:{code,message}} kept as fallback.
  const msg = typeof json?.error === 'string' ? json.error : json?.error?.message;
  if (!res.ok) throw new HttpError(res.status, json?.error?.code ?? 'HTTP_' + res.status, msg || res.statusText);
  return json as T;
}

export const get = <T = any>(p: string) => http<T>('GET', p);
export const post = <T = any>(p: string, b: unknown = {}) => http<T>('POST', p, b);
export const put = <T = any>(p: string, b: unknown) => http<T>('PUT', p, b);
export const patch = <T = any>(p: string, b: unknown) => http<T>('PATCH', p, b);
export const del = <T = any>(p: string) => http<T>('DELETE', p);

/** Authenticated file download (CSV export needs the Bearer header, so no plain <a href>). */
export async function download(path: string, filename: string) {
  const res = await fetch(path, { headers: { authorization: `Bearer ${getToken() ?? ''}` } });
  if (res.status === 401) onUnauthorized?.();
  if (!res.ok) throw new HttpError(res.status, 'HTTP_' + res.status, 'Gagal mengunduh');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(await res.blob());
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

/** Query string from an object, dropping empty values. */
export const qs = (o: Record<string, string | number | undefined>) =>
  new URLSearchParams(Object.entries(o).filter(([, v]) => v !== undefined && v !== '') as [string, string][]).toString();

/** DB file paths are mixed ("frames/x.svg" vs "/storage/frames/x.png"); normalize to a URL. */
export const media = (p: string) => (!p || /^(https?:)?\//.test(p) ? p : '/storage/' + p.replace(/^storage\//, ''));

export interface Page<T> {
  data: T[];
  meta: { total: number; page: number; lastPage: number };
}

export const rp = (n: number) => 'Rp' + (n ?? 0).toLocaleString('id-ID');
export const dt = (s: string | null | undefined) => (s ? new Date(s).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' }) : '—');
