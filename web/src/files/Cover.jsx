/**
 * A tab, seen from far enough away that a cell is a pixel.
 *
 * This is what the app shows instead of an icon: the sheet's own fills, drawn from a string
 * computed when the file was read. A calendar looks like a calendar, a squad map looks like a
 * map, and a roster looks like a roster — before anything is opened, and without a single cell
 * being fetched.
 *
 * Where there is nothing to draw — an empty tab, or a file that came in before covers existed —
 * a pattern is made up from the name instead. It is decoration and says so: the same name
 * always gives the same pattern, so a folder still looks like itself from one visit to the next,
 * but nobody should read anything into it.
 *
 * The four tones — text, number, formula, painted — come from the theme rather than the file,
 * so a cover reads in both light and dark. Real fills are drawn as they are, because a green
 * cell is green in anybody's theme.
 */
import { useEffect, useRef } from 'react';
import { useDark } from '../utils/theme.js';

const ALPHA = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+/';
const INDEX = new Map([...ALPHA].map((c, i) => [c, i]));
const TONE_ALPHA = { text: 0.55, number: 0.5, formula: 0.45, paint: 0.3 };

const tones = el => {
  const css = getComputedStyle(el);
  const v = (n, fallback) => css.getPropertyValue(n).trim() || fallback;
  return {
    text: v('--ink2', '#556'), number: v('--a0', '#28a'),
    formula: v('--accent', '#06f'), paint: v('--line3', '#bbb'),
    a1: v('--a1', '#c60'), a2: v('--a2', '#0a7'), a3: v('--a3', '#74d'),
  };
};

/** A small, stable random from a string: the same name always draws the same thing. */
function seeded(text) {
  let h = 2166136261;
  for (let i = 0; i < String(text).length; i++) {
    h ^= String(text).charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h ^= h << 13; h ^= h >>> 17; h ^= h << 5;
    return ((h >>> 0) % 10000) / 10000;
  };
}

function paintReal(ctx, cover, w, h, tone) {
  const colours = cover.palette.map(p => (!p ? null : p.charAt(0) === '#' ? p : tone[p] || tone.paint));
  const alphas = cover.palette.map(p => (p && p.charAt(0) === '#' ? 1 : TONE_ALPHA[p] || 1));
  const cw = w / cover.w, ch = h / cover.h;
  for (let i = 0; i < cover.map.length; i++) {
    const at = INDEX.get(cover.map.charAt(i));
    if (!at || !colours[at]) continue;
    ctx.globalAlpha = alphas[at];
    ctx.fillStyle = colours[at];
    ctx.fillRect((i % cover.w) * cw, Math.floor(i / cover.w) * ch,
                 Math.max(1, cw - 0.35), Math.max(1, ch - 0.35));
  }
  ctx.globalAlpha = 1;
}

/** Decoration for a tab with nothing in it, drawn from its name so it is at least consistent. */
function paintMade(ctx, seed, w, h, tone) {
  const rand = seeded(seed || 'kartz');
  const palette = [tone.formula, tone.number, tone.a2, tone.a3, tone.a1];
  const cols = 24, rows = 12;
  const cw = w / cols, ch = h / rows;
  for (let i = 0; i < 46; i++) {
    const c = Math.floor(rand() * cols);
    const r = Math.floor(rand() * rows);
    const span = 1 + Math.floor(rand() * 4);
    ctx.globalAlpha = 0.1 + rand() * 0.22;
    ctx.fillStyle = palette[Math.floor(rand() * palette.length)];
    ctx.fillRect(c * cw, r * ch, span * cw - 1, ch - 1);
  }
  ctx.globalAlpha = 1;
}

function paint(canvas, cover, seed) {
  const ctx = canvas.getContext('2d');
  const box = canvas.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(1, Math.round(box.width * dpr));
  const h = Math.max(1, Math.round(box.height * dpr));
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  ctx.clearRect(0, 0, w, h);
  const tone = tones(canvas);
  if (cover && cover.map) paintReal(ctx, cover, w, h, tone);
  else paintMade(ctx, seed, w, h, tone);
}

export default function Cover({ cover, seed, className = '', fade = false, title }) {
  const ref = useRef(null);
  const dark = useDark();

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return undefined;
    paint(canvas, cover, seed);
    if (typeof ResizeObserver === 'undefined') return undefined;
    // A cover is drawn to whatever size it happens to be, so it is redrawn when that changes.
    const ro = new ResizeObserver(() => paint(canvas, cover, seed));
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [cover, seed, dark]);

  return (
    <div className={'cover' + (fade ? ' cover--fade' : '') + (className ? ' ' + className : '')}
         title={title} aria-hidden="true">
      <canvas ref={ref} />
    </div>
  );
}
