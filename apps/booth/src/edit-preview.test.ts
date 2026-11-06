import { expect, test } from 'vitest';
import { defaultEdit } from '@photobooth/shared';
import { restorePhotoPreview } from './edit-preview';

test('restores inline photo transform after drag even when edit state did not change', () => {
  const style = { transform: 'translate(80px,40px)', filter: '', transition: 'transform .25s ease-out' };
  restorePhotoPreview(style, defaultEdit(), { w: 200, h: 100 });
  expect(style.transform).toBe('translate(0.00px,0.00px) rotate(0deg) scale(1,1)');
});
