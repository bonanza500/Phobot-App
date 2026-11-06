import { expect, test } from 'vitest';
import { canSwitchMode, freeModeOutdated, isFreeMode, modeChanged, qtyAfterModeSwitch } from './payment-mode';

test('uses explicit admin mode instead of inferring free mode from zero price', () => {
  expect(isFreeMode({ freeMode: false, pricing: { firstPrint: 0 } })).toBe(false);
  expect(isFreeMode({ freeMode: true, pricing: { firstPrint: 30000 } })).toBe(true);
  expect(isFreeMode({ pricing: { firstPrint: 0 } })).toBe(false);
});

test('only a free page that is asked to wait for payment counts as outdated', () => {
  const free = { freeMode: true, pricing: { firstPrint: 0 } };
  expect(freeModeOutdated(free, 'WAITING_PAYMENT')).toBe(true);
  expect(freeModeOutdated(free, 'PAYMENT_SUCCESS')).toBe(false);
  expect(freeModeOutdated({ freeMode: false, pricing: { firstPrint: 0 } }, 'WAITING_PAYMENT')).toBe(false);
});

test('mode changes on free mode or digital-only, and a missing flag means off', () => {
  expect(modeChanged({ freeMode: false }, { freeMode: true })).toBe(true);
  expect(modeChanged({ freeMode: true }, { freeMode: true, freeDigitalOnly: true })).toBe(true);
  expect(modeChanged({ freeMode: false, freeDigitalOnly: false }, {})).toBe(false);
});

test('mode only switches while there is nothing to pay for', () => {
  for (const status of [undefined, 'SELECT_PRINT', 'PAYMENT_FAILED']) expect(canSwitchMode(status, false)).toBe(true);
  for (const status of ['WAITING_PAYMENT', 'PAYMENT_SUCCESS', 'READY', 'CAPTURING', 'REVIEW', 'FINISHED']) expect(canSwitchMode(status, false)).toBe(false);
  expect(canSwitchMode('SELECT_PRINT', true)).toBe(false);
});

test('print quantity follows the new mode', () => {
  expect(qtyAfterModeSwitch({ freeMode: false }, { freeMode: true }, 5)).toBe(1);
  expect(qtyAfterModeSwitch({ freeMode: false }, { freeMode: true, freeDigitalOnly: true }, 5)).toBe(0);
  expect(qtyAfterModeSwitch({ freeMode: true, freeDigitalOnly: true }, { freeMode: false }, 0)).toBe(1);
  expect(qtyAfterModeSwitch({ freeMode: false }, { freeMode: false }, 3)).toBe(3);
});
