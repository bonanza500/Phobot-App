import { posedRobotSvg } from '@photobooth/ui';

/** A sticker placed on the frame. x/y = center, s = width; all fractions of the frame size. */
export interface Sticker {
  id: number;
  k: string;
  x: number;
  y: number;
  s: number;
}

const NS = 'xmlns="http://www.w3.org/2000/svg"';
const box = (body: string) => `<svg ${NS} viewBox="0 0 100 100" width="200" height="200">${body}</svg>`;
const robot = (pose: string) => posedRobotSvg(pose, 230).replace('<svg ', `<svg ${NS} `);
const W = 'stroke="#fff" stroke-width="4" stroke-linejoin="round"';

const ART: [string, string][] = [
  ...['wave', 'peace', 'heart', 'cool', 'thumbs', 'free', 'shock', 'laugh', 'cheer', 'peek', 'point', 'model'].map((p): [string, string] => ['rb_' + p, robot(p)]),
  ['star', box(`<path d="M50 6l13 28 30 3-23 20 7 30-27-16-27 16 7-30-23-20 30-3z" fill="#FFD166" ${W}/>`)],
  ['heart', box(`<path d="M50 88C10 60 4 34 22 20c12-9 24-4 28 8 4-12 16-17 28-8 18 14 12 40-28 68z" fill="#FF9EC4" ${W}/>`)],
  ['sparkle', box('<path d="M50 4C54 38 62 46 96 50C62 54 54 62 50 96C46 62 38 54 4 50C38 46 46 38 50 4z" fill="#B79CFF"/>')],
  ['camera', box('<rect x="34" y="16" width="32" height="18" rx="6" fill="#5EE0FF"/><rect x="8" y="28" width="84" height="58" rx="14" fill="#5EE0FF"/><circle cx="50" cy="57" r="20" fill="#fff"/><circle cx="50" cy="57" r="12" fill="#2B2A4C"/><circle cx="78" cy="40" r="5" fill="#FFD166"/>')],
  ['crown', box(`<path d="M10 76L16 28l20 22 14-30 14 30 20-22 6 48z" fill="#FFD166" ${W}/><circle cx="50" cy="60" r="6" fill="#FF9EC4"/>`)],
  ['flower', box(`${[0, 72, 144, 216, 288].map((a) => `<circle cx="50" cy="26" r="20" fill="#FFB8D6" transform="rotate(${a} 50 50)"/>`).join('')}<circle cx="50" cy="50" r="15" fill="#FFD166"/>`)],
  ['bolt', box(`<path d="M58 4L18 56h26l-8 40 46-56H54z" fill="#FFD166" ${W}/>`)],
  ['music', box('<path d="M38 74V20l46-10v52" stroke="#7B61FF" stroke-width="8" fill="none" stroke-linejoin="round"/><ellipse cx="28" cy="76" rx="14" ry="11" fill="#7B61FF"/><ellipse cx="74" cy="64" rx="14" ry="11" fill="#7B61FF"/>')],
  ['wow', box('<path d="M10 14h80a6 6 0 016 6v46a6 6 0 01-6 6H40l-18 16V72H10a6 6 0 01-6-6V20a6 6 0 016-6z" fill="#fff" stroke="#2B2A4C" stroke-width="4"/><text x="50" y="54" text-anchor="middle" font-family="Arial,sans-serif" font-weight="700" font-size="26" fill="#2B2A4C">WOW!</text>')],
  ['shades', box('<path d="M6 34h88" stroke="#2B2A4C" stroke-width="6" stroke-linecap="round"/><path d="M10 34h34v10a16 16 0 01-34 0zM56 34h34v10a16 16 0 01-34 0z" fill="#2B2A4C"/><path d="M16 40l8-4M62 40l8-4" stroke="#fff" stroke-width="4" stroke-linecap="round"/>')],
  ['rainbow', box('<g fill="none" stroke-width="10"><path d="M10 80a40 40 0 0180 0" stroke="#FF9EC4"/><path d="M20 80a30 30 0 0160 0" stroke="#FFD166"/><path d="M30 80a20 20 0 0140 0" stroke="#5EE0FF"/></g>')],
];

/** Palette: data-URL image (same pixels on screen and in the composed print) + height/width ratio. */
export const STICKERS = ART.map(([k, svg]) => ({ k, url: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg), ratio: k.startsWith('rb_') ? 240 / 230 : 1 }));
export const stickerArt = (k: string) => STICKERS.find((s) => s.k === k);
export const MAX_STICKERS = 20;
