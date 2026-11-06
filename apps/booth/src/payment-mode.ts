export function isFreeMode(config: { freeMode?: boolean; pricing: { firstPrint: number } } | null | undefined) {
  return config?.freeMode === true;
}

/**
 * Booth still shows the free page but the backend wants payment (admin turned Free Mode off
 * after this config was loaded). The free page has no QR, so waiting here would never end.
 */
export function freeModeOutdated(config: Parameters<typeof isFreeMode>[0], status: string) {
  return isFreeMode(config) && status === 'WAITING_PAYMENT';
}

type Mode = { freeMode?: boolean; freeDigitalOnly?: boolean };

export function modeChanged(current: Mode | null | undefined, next: Mode) {
  return (current?.freeMode === true) !== (next.freeMode === true) || (current?.freeDigitalOnly === true) !== (next.freeDigitalOnly === true);
}

/**
 * Mode may only change while nothing can be paid for. A QR on screen stays until it is paid,
 * expires or is left, because a customer may be scanning it right now; once paid, the session
 * finishes under the mode it started in.
 */
export function canSwitchMode(status: string | undefined, paymentInFlight: boolean) {
  return !paymentInFlight && (status === undefined || status === 'SELECT_PRINT' || status === 'PAYMENT_FAILED');
}

export function qtyAfterModeSwitch(current: Mode | null | undefined, next: Mode, qty: number) {
  if (next.freeMode === true) return next.freeDigitalOnly === true ? 0 : 1;
  return current?.freeMode === true ? 1 : qty;
}
