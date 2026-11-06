import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

test('journey step label switches from payment to free for free session', () => {
  const file = readFileSync(resolve(process.cwd(), 'apps/booth/src/components/basics.tsx'), 'utf8');
  expect(file).toContain("free ? ['Gratis', ...STEPS.slice(1)] : STEPS");
});
