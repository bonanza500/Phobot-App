import { expect, test, vi } from 'vitest';

vi.mock('@photobooth/ui', () => ({ posedRobotSvg: () => '', robotSvg: () => '', GLYPHS: {} }));
vi.mock('../voice', () => ({ voice: () => {} }));
const { bounce, flingVelocity } = await import('./floating');

test('bounce reflects off both walls and loses speed', () => {
  expect(bounce(500, 100, 1700)).toEqual([500, 100]);
  expect(bounce(-20, -1000, 1700)).toEqual([20, 700]);
  expect(bounce(1750, 1000, 1700)).toEqual([1650, -700]);
});

test('fling uses the last 80ms and is capped', () => {
  const slow = [{ x: 0, y: 0, t: 0 }, { x: 0, y: 0, t: 500 }, { x: 50, y: 0, t: 550 }];
  expect(flingVelocity(slow)).toEqual([1000, 0]);
  expect(Math.hypot(...flingVelocity([{ x: 0, y: 0, t: 0 }, { x: 900, y: 900, t: 50 }]))).toBeCloseTo(3000);
  expect(flingVelocity([{ x: 5, y: 5, t: 10 }])).toEqual([0, 0]);
});
