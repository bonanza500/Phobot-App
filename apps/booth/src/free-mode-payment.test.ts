import { beforeEach, expect, test, vi } from 'vitest';

const api = vi.hoisted(() => ({
  sessionId: 's1',
  mode: vi.fn(),
  payment: vi.fn(),
  abandonPayment: vi.fn(),
  config: vi.fn(),
}));

vi.mock('./api/client', () => ({
  api,
  ApiError: class extends Error {},
  NetworkError: class extends Error {},
  newRequestId: () => 'req',
  onConnectivity: () => () => undefined,
}));
vi.mock('./camera/service', () => ({ getCamera: vi.fn(), cameraInstance: vi.fn() }));
vi.mock('./robot/floating', () => ({ robot: { say: vi.fn() } }));
vi.mock('./voice', () => ({ clipSeconds: () => 0, loadAudioUploads: vi.fn(), paymentQrCue: () => null, voice: vi.fn() }));

const { selectQrPayment, syncMode } = await import('./flow');
const { get, set } = await import('./store');

const snap = (status: string, version: number) => ({ id: 's1', status, version, quantity: 1, payment: null });
const paidConfig = { freeMode: false, pricing: { firstPrint: 15000 } };
const freeConfig = { freeMode: true, pricing: { firstPrint: 0 } };
const digitalConfig = { ...freeConfig, freeDigitalOnly: true };

const settle = () => vi.waitFor(() => expect(get().payBusy).toBe(false));

beforeEach(() => {
  vi.clearAllMocks();
  api.config.mockResolvedValue(paidConfig);
  set({ qty: 1, busy: null, payBusy: false, payError: null, config: freeConfig, session: snap('SELECT_PRINT', 1) } as never);
});

test('free page asked to pay drops the QR, shows an error and picks up the new config', async () => {
  api.payment.mockResolvedValue(snap('WAITING_PAYMENT', 2));
  api.abandonPayment.mockReturnValue(snap('SELECT_PRINT', 3));

  selectQrPayment();
  await settle();

  expect(api.abandonPayment).toHaveBeenCalledOnce();
  expect(get().payError).toBeTruthy();
  expect(get().session?.status).toBe('SELECT_PRINT');
  await vi.waitFor(() => expect(get().config).toMatchObject({ freeMode: false }));
});

test('free session that is paid straight away is not treated as outdated', async () => {
  api.payment.mockResolvedValue(snap('PAYMENT_SUCCESS', 2));

  selectQrPayment();
  await settle();

  expect(api.abandonPayment).not.toHaveBeenCalled();
  expect(get().payError).toBeNull();
  expect(get().session?.status).toBe('PAYMENT_SUCCESS');
});

test('paid booth keeps waiting for its QR payment', async () => {
  set({ config: paidConfig } as never);
  api.payment.mockResolvedValue(snap('WAITING_PAYMENT', 2));

  selectQrPayment();
  await settle();

  expect(api.abandonPayment).not.toHaveBeenCalled();
  expect(get().payError).toBeNull();
  expect(get().session?.status).toBe('WAITING_PAYMENT');
});

test('switch from admin reaches an idle booth and only reloads config when it changed', async () => {
  set({ session: null } as never);
  api.mode.mockResolvedValue({ freeMode: true });
  await syncMode();
  expect(api.config).not.toHaveBeenCalled();

  api.mode.mockResolvedValue({ freeMode: false });
  await syncMode();
  expect(get().config).toMatchObject({ freeMode: false });
});

test('switch moves a customer who has no QR yet, clears the old error and fixes the quantity', async () => {
  set({ qty: 5, payError: 'lama', config: paidConfig } as never);
  api.mode.mockResolvedValue({ freeMode: true, freeDigitalOnly: true });
  api.config.mockResolvedValue(digitalConfig);

  await syncMode();

  expect(get().config).toMatchObject({ freeMode: true, freeDigitalOnly: true });
  expect(get().qty).toBe(0);
  expect(get().payError).toBeNull();
});

test('a QR on screen and a paid session keep their mode, and it applies once the QR expires', async () => {
  set({ config: paidConfig, session: snap('WAITING_PAYMENT', 1) } as never);
  api.mode.mockResolvedValue({ freeMode: true });
  api.config.mockResolvedValue(freeConfig);

  await syncMode();
  expect(get().config).toMatchObject({ freeMode: false });
  expect(api.abandonPayment).not.toHaveBeenCalled();

  set({ session: snap('PAYMENT_SUCCESS', 2) } as never);
  await syncMode();
  expect(get().config).toMatchObject({ freeMode: false });

  set({ session: snap('PAYMENT_FAILED', 3) } as never);
  await syncMode();
  expect(get().config).toMatchObject({ freeMode: true });
});

test('switch waits while a QR is being requested', async () => {
  set({ config: paidConfig } as never);
  let finish = (_: unknown) => {};
  api.payment.mockReturnValue(new Promise((r) => (finish = r)));
  api.mode.mockResolvedValue({ freeMode: true });
  api.config.mockResolvedValue(freeConfig);

  selectQrPayment();
  await syncMode();
  expect(api.mode).not.toHaveBeenCalled();

  finish(snap('SELECT_PRINT', 2));
  await settle();
  await syncMode();
  expect(get().config).toMatchObject({ freeMode: true });
});

test('QR requested while the switch is loading stops the switch', async () => {
  set({ config: paidConfig } as never);
  api.mode.mockResolvedValue({ freeMode: true });
  let loaded = (_: unknown) => {};
  api.config.mockReturnValue(new Promise((r) => (loaded = r)));
  api.payment.mockResolvedValue(snap('WAITING_PAYMENT', 2));

  const syncing = syncMode();
  await vi.waitFor(() => expect(api.config).toHaveBeenCalled());
  selectQrPayment();
  await settle();
  loaded(freeConfig);
  await syncing;

  expect(get().config).toMatchObject({ freeMode: false });
  expect(get().session?.status).toBe('WAITING_PAYMENT');
});

test('failed check or a config that fell back to defaults changes nothing', async () => {
  api.mode.mockRejectedValueOnce(new Error('down'));
  await syncMode();
  expect(get().config).toMatchObject({ freeMode: true });

  // Check says free, but full config lost /api/config and fell back to paid defaults.
  api.mode.mockResolvedValue({ freeMode: true, freeDigitalOnly: true });
  api.config.mockResolvedValue(paidConfig);
  await syncMode();
  expect(get().config).toEqual(freeConfig);
  expect(get().qty).toBe(1);

  // A failed check must not block the ticks after it.
  api.config.mockResolvedValue(digitalConfig);
  await syncMode();
  expect(get().config).toMatchObject({ freeMode: true, freeDigitalOnly: true });
});
