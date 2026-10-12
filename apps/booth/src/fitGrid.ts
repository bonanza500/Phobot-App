/**
 * Largest frame preview that fits `n` cards in a W×H box without overlap.
 * `chromeW`/`chromeH` = card space that is not the frame (padding, border, name, chip).
 * Below `minH` the grid scrolls instead of shrinking further.
 */
export function fitGrid(n: number, W: number, H: number, ratio: number, gap: number, chromeW: number, chromeH: number, minH: number) {
  let best = { cols: 1, frameH: 0, scroll: false };
  for (let cols = 1; cols <= Math.max(1, n); cols++) {
    const rows = Math.ceil(n / cols);
    const cellW = (W - (cols - 1) * gap) / cols;
    const cellH = (H - (rows - 1) * gap) / rows;
    const frameH = Math.min(cellH - chromeH, (cellW - chromeW) / ratio);
    if (frameH > best.frameH) best = { cols, frameH, scroll: false };
  }
  if (best.frameH >= minH) return { ...best, frameH: Math.floor(best.frameH) };
  // Too many to fit: fixed min size, as many columns as fit, vertical scroll.
  const cols = Math.max(1, Math.floor((W + gap) / (minH * ratio + chromeW + gap)));
  return { cols, frameH: minH, scroll: true };
}

/**
 * Like fitGrid, but each card holds `perCard` photos of `ratio`. Tries every in-card
 * layout (side by side … stacked) and keeps the one with the biggest photo whose card
 * is at least `minCardW` wide; if none is, the widest card wins.
 * `areaRatio` = w/h of the card's photo area (frameH × areaRatio = area width).
 */
export function fitCards(n: number, perCard: number, W: number, H: number, ratio: number, gap: number, chromeW: number, chromeH: number, minH: number, minCardW: number) {
  const k = Math.max(1, perCard);
  const opts = [];
  for (let pc = 1; pc <= k; pc++) {
    const pr = Math.ceil(k / pc);
    const areaRatio = (pc * ratio) / pr;
    const g = fitGrid(n, W, H, areaRatio, gap, chromeW, chromeH, minH);
    opts.push({ ...g, areaRatio, photoH: g.frameH / pr, cardW: g.frameH * areaRatio + chromeW });
  }
  const ok = opts.filter((o) => o.cardW >= minCardW);
  return ok.length ? ok.reduce((a, b) => (b.photoH > a.photoH ? b : a)) : opts.reduce((a, b) => (b.cardW > a.cardW ? b : a));
}
