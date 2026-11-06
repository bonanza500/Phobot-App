import { beforeEach, expect, test, vi } from 'vitest';
import { api } from './client';

const pkg = (price: number, print: number) => [{ id: 2, code: 'vip', price, print_unit_price: print, duration_secs: 600, is_popular: true }];
const json = (data: unknown) => new Response(JSON.stringify({ success: true, data }), { headers: { 'content-type': 'application/json' } });

/** Backend whose mode flips right after the n-th /api/package read, as if admin clicked at that moment. */
function backend({ freeUntilPackageRead }: { freeUntilPackageRead: number }) {
  let reads = 0;
  const free = () => reads < freeUntilPackageRead;
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/api/package') {
      const res = json(free() ? pkg(0, 0) : pkg(35000, 15000));
      reads++;
      return res;
    }
    if (url === '/api/config') return json({ freeMode: free() });
    if (url === '/api/frames') return json([]);
    return json({ test_payment_enabled: false });
  }));
}

beforeEach(() => vi.unstubAllGlobals());

test('config read while admin leaves free mode never pairs paid mode with free prices', async () => {
  backend({ freeUntilPackageRead: 1 });
  const config = await api.config();
  expect(config.freeMode).toBe(false);
  expect(config.pricing.firstPrint).toBe(50000);
});

test('config read while nothing changes asks for the packages once', async () => {
  backend({ freeUntilPackageRead: 0 });
  const config = await api.config();
  expect(config.freeMode).toBe(false);
  expect(config.pricing.firstPrint).toBe(50000);
  expect(vi.mocked(fetch).mock.calls.filter(([url]) => url === '/api/package')).toHaveLength(1);
});

test('losing /api/config still falls back to paid defaults instead of failing', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/api/config') throw new Error('down');
    if (url === '/api/package') return json(pkg(35000, 15000));
    if (url === '/api/frames') return json([]);
    return json({ test_payment_enabled: false });
  }));
  expect((await api.config()).freeMode).toBe(false);
});
