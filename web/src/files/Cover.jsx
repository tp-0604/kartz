/**
 * A tab, seen from far enough away that a cell is a pixel.
 *
 * This is what the app shows instead of an icon: the sheet's own fills, drawn from a string
 * computed when the file was read. A calendar looks like a calendar, a squad map looks like a
 * map, and a roster looks like a roster — before anything is opened, and without a single cell
 * being fetched.
 *
 * The four tones — text, number, formula, painted — come from the theme rather than the file,
 * so a cover reads in both light and dark. Real fills are drawn as they are, because a green
 * cell is green in anybody's theme.
 */
import { useEffect, useRef } from 'react';
import { useDark } from '../utils/theme.js';

const ALPHA = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+/';
const INDEX = new Map([...ALPHA].map((c, i) => [c, i]));

const ALPHA_OF = { text: 0.55, number: 0.5, formula: 0.45, paint: 0.3 };

function paint(canvas, cover) {
  const ctx = canvas.getContext('2d');
  const box = canvas.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(1, Math.round(box.width * dpr));
  const h = Math.max(1, Math.round(box.height * dpr));
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  ctx.clearRect(0, 0, w, h);
  if (!cover || !cover.map) return;

  const css = getComputedStyle(canvas);
  const tone = {
    text: css.getPropertyValue('--ink2').trim() || '#556',
    number: css.getPropertyValue('--a0').trim() || '#28a',
    formula: css.getPropertyValue('--accent').trim() || '#06f',
    paint: css.getPropertyValue('--line3').trim() || '#bbb',
  };
  const colours = cover.palette.map(p => (!p ? null : p.charAt(0) === '#' ? p : tone[p] || tone.paint));
  const alphas = cover.palette.map(p => (p && p.charAt(0) === '#' ? 1 : ALPHA_OF[p] || 1));

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

export default function Cover({ cover, className = '', fade = false, title }) {
  const ref = useRef(null);
  const dark = useDark();

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return undefined;
    paint(canvas, cover);
    // A cover is drawn to the size it happens to be, so it is redrawn when that changes.
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => paint(canvas, cover));
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [cover, dark]);

  return (
    <div className={'cover' + (fade ? ' cover--fade' : '') + (className ? ' ' + className : '')}
         title={title} aria-hidden="true">
      {cover ? <canvas ref={ref} /> : <span className="cover__none" />}
    </div>
  );
}
