// Run from UI-DOBOT: node prototype/start/check.mjs
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const dir = fileURLToPath(new URL('.', import.meta.url));
const shots = `${dir}shots/`;
mkdirSync(shots, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(pathToFileURL(`${dir}index.html`).href);
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(400);

// Layout: nothing clipped, title clear of the lens, bubble inside the stage.
const box = await page.evaluate(() => {
  const r = (s) => document.querySelector(s).getBoundingClientRect();
  const h1 = document.querySelector('h1');
  const range = document.createRange();
  range.selectNodeContents(h1);
  const text = [...range.getClientRects()].reduce((m, x) => Math.max(m, x.right), 0);
  const lens = r('.lens');
  const cx = lens.left + lens.width / 2, cy = lens.top + lens.height / 2, R = lens.width * 0.48;
  // Nearest distance from any title line box to the outer circle centre.
  const lines = [...range.getClientRects()];
  const gap = Math.min(...lines.map((l) => {
    const dx = Math.max(l.left - cx, 0, cx - l.right), dy = Math.max(l.top - cy, 0, cy - l.bottom);
    return Math.hypot(dx, dy) - R;
  }));
  const over = [...document.querySelectorAll('.chip,h1,.cta p,.arrow,.bubble-in')].filter((e) => {
    const b = e.getBoundingClientRect();
    return b.left < 0 || b.top < 0 || b.right > 1920 || b.bottom > 1080 || e.scrollWidth > e.clientWidth + 1;
  }).map((e) => e.className || e.tagName);
  return { titleRight: text, gap, over, bubble: r('.bubble-in'), bot: r('#bot') };
});
console.log('title right edge', Math.round(box.titleRight), 'gap to lens', Math.round(box.gap), 'bubble', box.bubble.top, box.bubble.bottom);
assert.ok(box.gap > 40, `title too close to lens: ${box.gap}`);
assert.deepEqual(box.over, [], 'clipped elements');
await page.screenshot({ path: `${shots}a-start.png` });

// Tap the robot, then try to trigger again (click + Enter + Space).
let transitions = 0;
await page.exposeFunction('countNext', () => transitions++);
await page.evaluate(() => new MutationObserver(() => document.getElementById('stage').classList.contains('next') && window.countNext())
  .observe(document.getElementById('stage'), { attributes: true, attributeFilter: ['class'] }));
const t0 = Date.now();
await page.click('#bot', { position: { x: 310, y: 400 } });
await page.click('#bot', { position: { x: 310, y: 400 }, force: true });
await page.focus('#bot');
await page.keyboard.press('Enter');
await page.keyboard.press(' ');
await page.waitForTimeout(650 - (Date.now() - t0));
await page.screenshot({ path: `${shots}b-ninja.png` });
const puffs = await page.locator('.puff').count();
console.log('puffs at 650ms', puffs);
assert.ok(puffs >= 9, 'smoke puffs missing');

await page.waitForTimeout(1500 - (Date.now() - t0));
assert.equal(await page.isVisible('#page2'), false, 'moved on before animation ended');
await page.waitForTimeout(2600 - (Date.now() - t0));
assert.equal(await page.isVisible('#page2'), true, 'page 2 not shown');
await page.screenshot({ path: `${shots}c-page2.png` });
assert.equal(transitions, 1, `transition fired ${transitions}×`);
assert.equal(await page.locator('.puff').count(), 0, 'puffs not cleaned up');

// Reduced motion still works.
const rm = await browser.newPage({ viewport: { width: 1920, height: 1080 }, reducedMotion: 'reduce' });
rm.on('pageerror', (e) => errors.push(e.message));
await rm.goto(pathToFileURL(`${dir}index.html`).href);
await rm.keyboard.press('Tab');
await rm.keyboard.press('Enter');
await rm.waitForTimeout(1100);
assert.equal(await rm.isVisible('#page2'), true, 'reduced motion: page 2 not shown');

assert.deepEqual(errors, [], 'console errors');
await browser.close();
console.log('OK');
