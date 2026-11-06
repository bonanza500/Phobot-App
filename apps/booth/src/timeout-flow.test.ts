import { expect, test } from 'vitest';
import { timeoutAction } from './timeout-flow';

test('selection and edit timeouts advance one page instead of auto-completing output', () => {
  expect(timeoutAction('REVIEW')).toBe('choose-frame');
  expect(timeoutAction('FRAME_SELECTION')).toBe('confirm-frame');
  expect(timeoutAction('PHOTO_SELECTION')).toBe('auto-pick');
  expect(timeoutAction('EDITING')).toBe('finish-edit');
  expect(timeoutAction('FINAL_PREVIEW')).toBe('confirm-output');
});
