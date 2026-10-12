import { expect, test } from 'vitest';
import { computeFrameLayout, DEFAULT_TEMPLATES } from '@photobooth/shared';
import { fitCards, fitGrid } from './fitGrid';

const ratio = 464 / 696;
const [W, H, gap, cw, ch] = [1776, 720, 24, 40, 140];

test('cards never exceed the box', () => {
  for (const n of [1, 2, 3, 8, 12, 21, 40]) {
    const g = fitGrid(n, W, H, ratio, gap, cw, ch, 200);
    const cardW = g.frameH * ratio + cw;
    expect(g.cols * cardW + (g.cols - 1) * gap).toBeLessThanOrEqual(W);
    if (!g.scroll) {
      const rows = Math.ceil(n / g.cols);
      expect(rows * (g.frameH + ch) + (rows - 1) * gap).toBeLessThanOrEqual(H);
    }
  }
});

test('review cards: every frame fits, photos never shrink, odd ratios go side by side', () => {
  const [w, h, g, cw, chr] = [1776, 720, 24, 36, 156];
  for (const t of DEFAULT_TEMPLATES) {
    const s = computeFrameLayout(t, 1000).slots[0];
    const r = s.w / s.h;
    const c = fitCards(10, 2, w, h, r, g, cw, chr, 60, 260);
    const cardW = c.frameH * c.areaRatio + cw;
    expect(c.cols * cardW + (c.cols - 1) * g, t.name).toBeLessThanOrEqual(w + 1);
    const rows = Math.ceil(10 / c.cols);
    expect(rows * (c.frameH + chr) + (rows - 1) * g, t.name).toBeLessThanOrEqual(h + 1);
    const old = fitGrid(10, w, h, r, g, cw, chr, 60);
    const oldPhoto = fitGrid(2, old.frameH * r, old.frameH, r, 10, 0, 0, 0).frameH;
    expect(c.photoH, t.name).toBeGreaterThanOrEqual(oldPhoto - 1);
  }
  expect(fitCards(10, 2, w, h, 0.71, g, cw, chr, 60, 260).areaRatio).toBeCloseTo(1.42);
});

test('12 frames fit without scrolling, 60 scroll', () => {
  expect(fitGrid(12, W, H, ratio, gap, cw, ch, 200).scroll).toBe(false);
  expect(fitGrid(60, W, H, ratio, gap, cw, ch, 200).scroll).toBe(true);
});
