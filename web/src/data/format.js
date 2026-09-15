/**
 * Marking a board up: fills, text colour, bold, italic, underline, alignment.
 *
 * Two decisions shape the whole thing.
 *
 * **It lives on the row.** A row has an id nothing edits, so a fill follows its player through a
 * sort, a filter, a rank correction and a re-extraction. Anything keyed by position would not
 * survive the first click on a column heading.
 *
 * **A swatch is a name, not a colour.** What is stored is "yellow", and the theme decides what
 * yellow is. A hex stored in daylight is unreadable at night, and this application has a dark
 * mode people actually use. Every pair below was checked against both surfaces: normal text
 * reads at 10:1 or better on every fill, and every text colour clears 4.5:1 on the panel.
 */

// [light, dark]
export const FILLS = {
  grey:   ['#e6e9ee', '#2b323c'],
  red:    ['#fbdfdc', '#43221f'],
  orange: ['#fce6d2', '#402a17'],
  yellow: ['#faf0c8', '#3b3417'],
  green:  ['#ddf0e0', '#1c3524'],
  teal:   ['#d6eeeb', '#12332f'],
  blue:   ['#dce8f8', '#1b2c42'],
  purple: ['#e6e0f6', '#2b2440'],
  pink:   ['#fbdeec', '#3d2030'],
};

export const INKS = {
  red:    ['#a5312a', '#e08981'],
  orange: ['#8a5410', '#d9a05e'],
  green:  ['#26714a', '#5cc389'],
  teal:   ['#1c6d66', '#4cb2a7'],
  blue:   ['#2c5f96', '#79aae4'],
  purple: ['#5b4a9c', '#a99ae8'],
  pink:   ['#9c3767', '#e086b0'],
  grey:   ['#6b7787', '#8994a3'],
};

export const FILL_NAMES = Object.keys(FILLS);
export const INK_NAMES = Object.keys(INKS);

// The whole row, rather than one of its cells.
export const ROW = '__row';

/** The keys a style may carry. Anything else is dropped on the way in and on the way out. */
export const STYLE_KEYS = ['bg', 'fg', 'b', 'i', 'u', 'a'];
const ALIGN = ['left', 'center', 'right'];

/** A style object with only the things that are actually settable, and nothing empty. */
export function cleanStyle(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const out = {};
  if (FILLS[raw.bg]) out.bg = raw.bg;
  if (INKS[raw.fg]) out.fg = raw.fg;
  if (raw.b) out.b = 1;
  if (raw.i) out.i = 1;
  if (raw.u) out.u = 1;
  if (ALIGN.includes(raw.a)) out.a = raw.a;
  return Object.keys(out).length ? out : null;
}

/** The whole bag: column key → style, plus the row's own. */
export function cleanBag(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    const s = cleanStyle(v);
    if (s) out[k] = s;
  }
  return Object.keys(out).length ? out : null;
}

/** A patch applied to a style. A key set to null clears it; that is how "no fill" is said. */
export function mergeStyle(current, patch) {
  const next = { ...(current || {}) };
  for (const k of STYLE_KEYS) {
    if (!(k in patch)) continue;
    if (patch[k] === null || patch[k] === false || patch[k] === '') delete next[k];
    else next[k] = patch[k];
  }
  return cleanStyle(next);
}

/** What a cell actually wears: the row's style, with the cell's own on top. */
export function styleFor(row, columnKey) {
  const bag = row && row.__style;
  if (!bag) return null;
  const r = bag[ROW], c = bag[columnKey];
  if (!r && !c) return null;
  return { ...(r || {}), ...(c || {}) };
}

/** A style as the properties the grid sets on a cell. `dark` picks the swatch's other half. */
export function cssFor(style, dark) {
  if (!style) return null;
  const css = {};
  if (style.bg) css.background = FILLS[style.bg][dark ? 1 : 0];
  if (style.fg) css.color = INKS[style.fg][dark ? 1 : 0];
  if (style.b) css.fontWeight = 700;
  if (style.i) css.fontStyle = 'italic';
  if (style.u) css.textDecoration = 'underline';
  if (style.a) css.justifyContent = style.a === 'right' ? 'flex-end' : style.a === 'center' ? 'center' : 'flex-start';
  return css;
}

/**
 * What a toolbar should show as "on" for the current selection: a property is on when every
 * selected cell has it, the way a word processor decides whether the B is lit.
 */
export function commonStyle(rows, columnKeys) {
  let first = true;
  let shared = {};
  for (const row of rows) {
    for (const key of columnKeys) {
      const s = styleFor(row, key) || {};
      if (first) { shared = { ...s }; first = false; continue; }
      for (const k of Object.keys(shared)) if (shared[k] !== s[k]) delete shared[k];
    }
  }
  return shared;
}
