import { expect, test } from 'vitest';
import { timeoutWarningText } from './timeout-notification';

test('shows warning only during final seconds of page timeout', () => {
  expect(timeoutWarningText('limit', 15, 15)).toBe('Sesi berakhir dalam 15 detik');
  expect(timeoutWarningText('limit', 0, 15)).toBeNull();
  expect(timeoutWarningText('limit', 20, 15)).toBeNull();
  expect(timeoutWarningText('est', 10, 15)).toBeNull();
});
