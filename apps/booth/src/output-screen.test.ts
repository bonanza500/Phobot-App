import { expect, test } from 'vitest';
import { outputScreen } from './output-screen';

test('digital-only output shows QR, not print progress', () => {
  expect(outputScreen('RENDERING', 0)).toBe('qr');
  expect(outputScreen('GENERATING_GALLERY', 0)).toBe('qr');
  expect(outputScreen('PRINT_FAILED', 0)).toBe('qr');
  expect(outputScreen('PRINTING', 1)).toBe('print');
  expect(outputScreen('RENDERING', 1)).toBe('print');
});
