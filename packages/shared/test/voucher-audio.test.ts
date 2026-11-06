import { expect, test } from 'vitest';
import { voucherAudioCue } from '../../../apps/booth/src/flow';

test('maps voucher outcomes to their own audio cue', () => {
  expect(voucherAudioCue('invalid')).toBe('voucher_error');
  expect(voucherAudioCue('partial')).toBe('voucher_partial');
  expect(voucherAudioCue('free')).toBe('voucher_free');
});
