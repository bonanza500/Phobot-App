import { expect, test } from 'vitest';
import { audioRecommendation } from '../../../apps/admin/src/pages/Audio';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

test('recommends only clips that lack both upload and built-in audio', () => {
  expect(audioRecommendation({ uploaded: false, hasDefault: false })).toBe(true);
  expect(audioRecommendation({ uploaded: true, hasDefault: false })).toBe(false);
  expect(audioRecommendation({ uploaded: false, hasDefault: true })).toBe(false);
});

test('ready screen tells guest to find a position and keep safe robot distance', () => {
  const file = readFileSync(resolve(process.cwd(), 'apps/booth/src/screens/Capture.tsx'), 'utf8');
  expect(file).toContain('Cari posisi nyaman dan jaga jarak dari robot.');
});
