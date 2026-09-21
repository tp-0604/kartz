/**
 * Turning what a file says into what a browser draws.
 *
 * A cell arrives as a value, a style index and — sometimes — a rule that paints it only when
 * the value says so. Excel's conditional formats are a small language: this understands the
 * five kinds these files actually use and ignores the rest rather than guessing. An unhandled
 * rule leaves the cell as it is, which is wrong in the least misleading direction.
 */

const SIDES = { top: 'Top', right: 'Right', bottom: 'Bottom', left: 'Left' };
const WEIGHT = { hair: '1px', thin: '1px', medium: '2px', thick: '3px', double: '3px' };

/** Does this format code mean a date? Enough to know whether a serial number is a day. */
export function isDateFormat(code) {
  if (!code || code === 'General') return false;
  const bare = String(code).replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '');
  return /[dmy]/i.test(bare);
}

/** A value as the file's format asks for it. Not a formatting engine — the cases these files use. */
export function show(cell, style) {
  const v = cell[2];
  if (v === null || v === undefined) return '';
  if (cell[3] === 'e') return String(v);
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v !== 'number') return String(v);
  const fmt = style && style.numFmt;
  if (fmt && isDateFormat(fmt)) {
    // An Excel serial: days since 1899-12-30, the one date every spreadsheet agrees on.
    const d = new Date(Math.round((v - 25569) * 86400000));
    if (Number.isFinite(d.getTime())) {
      return /[hs]/.test(fmt.replace(/"[^"]*"/g, ''))
        ? d.toISOString().slice(0, 16).replace('T', ' ')
        : d.toISOString().slice(0, 10);
    }
  }
  if (fmt && fmt.indexOf('%') !== -1) {
    const dp = (fmt.split('.')[1] || '').replace(/[^0]/g, '').length;
    return (v * 100).toFixed(dp) + '%';
  }
  if (fmt && fmt.indexOf(',') !== -1) {
    const dp = (fmt.split('.')[1] || '').replace(/[^0]/g, '').length;
    return v.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp });
  }
  return String(Math.round(v * 1e10) / 1e10);
}

/** One cell's own style, as CSS. */
export function cellCss(style) {
  if (!style) return undefined;
  const css = {};
  if (style.fill) css.background = style.fill;
  if (style.color) css.color = style.color;
  if (style.bold) css.fontWeight = 700;
  if (style.italic) css.fontStyle = 'italic';
  const lines = [];
  if (style.underline) lines.push('underline');
  if (style.strike) lines.push('line-through');
  if (lines.length) css.textDecoration = lines.join(' ');
  if (style.size) css.fontSize = Math.max(9, Math.min(28, style.size)) + 'px';
  if (style.align) css.textAlign = style.align;
  if (style.valign) css.verticalAlign = style.valign === 'center' ? 'middle' : style.valign;
  if (style.wrap) { css.whiteSpace = 'normal'; css.wordBreak = 'break-word'; }
  if (style.indent) css.paddingLeft = (6 + style.indent * 8) + 'px';
  if (style.border) {
    for (const [side, spec] of Object.entries(style.border)) {
      if (!SIDES[side] || !spec) continue;
      css['border' + SIDES[side]] = `${WEIGHT[spec.style] || '1px'} `
        + `${spec.style === 'double' ? 'double' : 'solid'} ${spec.color || 'currentColor'}`;
    }
  }
  return css;
}

/* --------------------------------------------------------------------------- ranges */

const refOf = ref => {
  const m = /^\$?([A-Z]+)\$?(\d+)$/.exec(String(ref || '').trim().toUpperCase());
  if (!m) return null;
  let c = 0;
  for (const ch of m[1]) c = c * 26 + (ch.charCodeAt(0) - 64);
  return { r: +m[2] - 1, c: c - 1 };
};

/** "A1:C9 E2:E9" → rectangles. A sqref can hold several, separated by spaces. */
export function parseSqref(sqref) {
  const out = [];
  for (const part of String(sqref || '').trim().split(/\s+/)) {
    if (!part) continue;
    const [a, b] = part.split(':');
    const from = refOf(a), to = refOf(b || a);
    if (!from || !to) continue;
    out.push({ r1: Math.min(from.r, to.r), c1: Math.min(from.c, to.c),
               r2: Math.max(from.r, to.r), c2: Math.max(from.c, to.c) });
  }
  return out;
}

export const inRange = (rect, r, c) => r >= rect.r1 && r <= rect.r2 && c >= rect.c1 && c <= rect.c2;

/* ------------------------------------------------------- conditional formats and dropdowns */

const numberOf = v => {
  if (typeof v === 'number') return v;
  const n = Number(String(v ?? '').replace(/[,\s"]/g, ''));
  return Number.isFinite(n) ? n : null;
};

const mix = (a, b, t) => Math.round(a + (b - a) * t);
const hexOf = c => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(c || ''));
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/** A colour scale's colour for a value between two ends. */
function scaleColour(colours, t) {
  const stops = colours.map(hexOf).filter(Boolean);
  if (stops.length < 2) return null;
  const span = 1 / (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(t / span));
  const local = (t - i * span) / span;
  const [a, b] = [stops[i], stops[i + 1]];
  return `rgb(${mix(a[0], b[0], local)}, ${mix(a[1], b[1], local)}, ${mix(a[2], b[2], local)})`;
}

const TESTS = {
  greaterThan: (v, a) => v !== null && a !== null && v > a,
  greaterThanOrEqual: (v, a) => v !== null && a !== null && v >= a,
  lessThan: (v, a) => v !== null && a !== null && v < a,
  lessThanOrEqual: (v, a) => v !== null && a !== null && v <= a,
  equal: (v, a) => String(v) === String(a),
  notEqual: (v, a) => String(v) !== String(a),
  between: (v, a, b) => v !== null && a !== null && b !== null && v >= Math.min(a, b) && v <= Math.max(a, b),
  notBetween: (v, a, b) => !(v !== null && a !== null && b !== null && v >= Math.min(a, b) && v <= Math.max(a, b)),
};

/**
 * Prepare a sheet's conditional formats: parse the ranges once, and work out the low and high
 * of any colour scale, so each cell is a lookup rather than a scan.
 */
export function prepareRules(condFmts, cells) {
  const out = [];
  for (const block of condFmts || []) {
    const rects = parseSqref(block.sqref);
    if (!rects.length) continue;
    for (const rule of block.rules || []) {
      const prepared = { rects, type: rule.type, style: rule.style || null,
                         operator: rule.operator, text: rule.text,
                         formulas: (rule.formulas || []).map(f => String(f)) };
      if (rule.type === 'colorScale' && rule.colors) {
        let low = Infinity, high = -Infinity;
        for (const cell of cells) {
          if (!rects.some(rect => inRange(rect, cell[0], cell[1]))) continue;
          const n = numberOf(cell[2]);
          if (n === null) continue;
          if (n < low) low = n;
          if (n > high) high = n;
        }
        if (!Number.isFinite(low) || low === high) continue;
        prepared.colors = rule.colors;
        prepared.low = low;
        prepared.high = high;
      }
      out.push(prepared);
    }
  }
  // The lowest priority number wins in Excel; applying in reverse lets the last write stand.
  return out.sort((a, b) => (b.priority || 0) - (a.priority || 0));
}

/** What a rule paints on one cell, if anything. */
export function ruleCss(rules, r, c, value) {
  let css = null;
  for (const rule of rules) {
    if (!rule.rects.some(rect => inRange(rect, r, c))) continue;
    const text = value === null || value === undefined ? '' : String(value);
    let hit = false, paint = rule.style;

    if (rule.type === 'cellIs') {
      const test = TESTS[rule.operator];
      hit = !!test && test(numberOf(value), numberOf(rule.formulas[0]), numberOf(rule.formulas[1]));
      if (!hit && (rule.operator === 'equal' || rule.operator === 'notEqual')) {
        hit = TESTS[rule.operator](text, String(rule.formulas[0] || '').replace(/^"|"$/g, ''));
      }
    } else if (rule.type === 'containsText') {
      hit = !!rule.text && text.toLowerCase().includes(String(rule.text).toLowerCase());
    } else if (rule.type === 'containsBlanks') {
      hit = text.trim() === '';
    } else if (rule.type === 'notContainsBlanks') {
      hit = text.trim() !== '';
    } else if (rule.type === 'colorScale' && rule.colors) {
      const n = numberOf(value);
      if (n !== null) {
        const colour = scaleColour(rule.colors, Math.max(0, Math.min(1, (n - rule.low) / (rule.high - rule.low))));
        if (colour) { hit = true; paint = { fill: colour }; }
      }
    }
    // 'expression' needs a formula engine, which this is not. Left alone on purpose.

    if (!hit || !paint) continue;
    css = css || {};
    if (paint.fill) css.background = paint.fill;
    if (paint.color) css.color = paint.color;
    if (paint.bold) css.fontWeight = 700;
    if (paint.italic) css.fontStyle = 'italic';
  }
  return css;
}

/**
 * The dropdowns a sheet has, by cell. A list is either written into the rule — "Yes,No" — or
 * points at a range somewhere, which the app cannot follow yet and says so instead of pretending.
 */
export function prepareValidation(validations) {
  const out = [];
  for (const v of validations || []) {
    if (v.type !== 'list') continue;
    const rects = parseSqref(v.sqref);
    if (!rects.length) continue;
    const raw = String(v.formula1 || '').trim();
    const inline = /^"(.*)"$/.exec(raw);
    out.push({
      rects,
      options: inline ? inline[1].split(',').map(x => x.trim()).filter(Boolean) : null,
      from: inline ? null : raw,
    });
  }
  return out;
}

export const validationAt = (list, r, c) =>
  list.find(v => v.rects.some(rect => inRange(rect, r, c))) || null;
