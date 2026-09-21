/**
 * Reading a whole .xlsx: the values, and everything drawn around them.
 *
 * The app already had a reader for the values alone (xlsx.js) — enough to pull rows out of a
 * tracking workbook. This one is for keeping a sheet as it looked: fonts and fills, merged
 * cells, column widths, frozen panes, dropdowns, conditional formats, tab colours. Same
 * approach as before — an .xlsx is a zip of XML, fflate unzips it, and the rest is a scanner —
 * because a library that reads all of this costs the best part of a megabyte and this costs
 * none.
 *
 * Two things in these particular files need naming, because they are Google's doing rather
 * than Excel's:
 *
 *   Shared formulas. Four cells in five that hold a formula don't hold its text: they point at
 *   a master cell by number, and the text has to be shifted to where they sit. That is what
 *   shiftFormula does, and without it four hundred thousand cells arrive empty.
 *
 *   __xludf.DUMMYFUNCTION. When a Sheets-only function is exported — QUERY, FILTER,
 *   IMPORTRANGE, ARRAYFORMULA — Google wraps its last computed value in a call no spreadsheet
 *   can evaluate, and tucks the original formula inside as a string. The value is real and is
 *   kept; the formula is lifted out and recorded as a note rather than handed on as something
 *   that would only show an error.
 */

const dec = new TextDecoder();

/* ------------------------------------------------------------------------ small XML helpers */

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** Entities, including the numeric forms Google emits for emoji and exotic scripts. */
export function unescapeXml(s) {
  if (!s || s.indexOf('&') === -1) return s || '';
  return s.replace(/&(?:(amp|lt|gt|quot|apos)|#(x?)([0-9a-fA-F]+));/g, (_, name, hex, code) => {
    if (name) return ENT[name];
    const n = parseInt(code, hex ? 16 : 10);
    return Number.isFinite(n) ? String.fromCodePoint(n) : '';
  });
}

/** The attributes of one tag, as an object. Values arrive unescaped. */
export function attrs(tag) {
  const out = {};
  const re = /([\w:.-]+)="([^"]*)"/g;
  let m;
  while ((m = re.exec(tag))) out[m[1]] = unescapeXml(m[2]);
  return out;
}

/** "BC" -> 54. Column letters are the only place xlsx uses a base-26 without a zero. */
export function colIndex(letters) {
  let n = 0;
  for (let i = 0; i < letters.length; i++) n = n * 26 + (letters.charCodeAt(i) - 64);
  return n - 1;
}

/** 54 -> "BC". */
export function colName(n) {
  let s = '';
  for (n += 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

/** "B7" -> { r: 6, c: 1 }, zero-based, the way the rest of the app counts. */
export function parseRef(ref) {
  const m = /^\$?([A-Z]+)\$?(\d+)$/.exec(ref || '');
  return m ? { r: +m[2] - 1, c: colIndex(m[1]) } : null;
}

const tags = (xml, name) => {
  const out = [];
  const re = new RegExp('<' + name + '\\b([^>]*?)(?:/>|>([\\s\\S]*?)</' + name + '>)', 'g');
  let m;
  while ((m = re.exec(xml))) out.push({ attrs: attrs(m[1]), body: m[2] || '', raw: m[0] });
  return out;
};

const first = (xml, name) => tags(xml, name)[0] || null;

/* ---------------------------------------------------------------------------------- the zip */

async function unzipAll(input) {
  const fflate = await import('fflate');
  const bytes = input instanceof Uint8Array ? input
    : input instanceof ArrayBuffer ? new Uint8Array(input)
    : new Uint8Array(await input.arrayBuffer());
  return new Promise((resolve, reject) => {
    fflate.unzip(bytes, (err, files) => (err ? reject(err) : resolve(files)));
  });
}

/* ------------------------------------------------------------------------------ the pieces */

/** The shared string table. A string may arrive in several runs; phonetic hints are dropped. */
function readSharedStrings(xml) {
  const out = [];
  if (!xml) return out;
  const si = /<si>([\s\S]*?)<\/si>/g;
  let m;
  while ((m = si.exec(xml))) {
    const body = m[1].replace(/<rPh[\s\S]*?<\/rPh>/g, '');
    let text = '';
    const t = /<t[^>]*>([\s\S]*?)<\/t>/g;
    let n;
    while ((n = t.exec(body))) text += unescapeXml(n[1]);
    out.push(text);
  }
  return out;
}

// The theme palette, in the order the schema lists it. Slots 0/1 and 2/3 are swapped on the
// way in, because a theme file names them light/dark and a style refers to them by position.
const THEME_ORDER = ['lt1', 'dk1', 'lt2', 'dk2', 'accent1', 'accent2', 'accent3', 'accent4',
                     'accent5', 'accent6', 'hlink', 'folHlink'];

function readTheme(xml) {
  const out = [];
  if (!xml) return out;
  const scheme = /<a:clrScheme[\s\S]*?<\/a:clrScheme>/.exec(xml);
  if (!scheme) return out;
  for (const key of THEME_ORDER) {
    const el = new RegExp('<a:' + key + '>([\\s\\S]*?)</a:' + key + '>').exec(scheme[0]);
    const hex = el && (/<a:srgbClr val="([0-9A-Fa-f]{6})"/.exec(el[1])
                    || /<a:sysClr[^>]*lastClr="([0-9A-Fa-f]{6})"/.exec(el[1]));
    out.push(hex ? '#' + hex[1].toUpperCase() : null);
  }
  return out;
}

/** Excel's legacy indexed palette, for the few files that still use it. */
const INDEXED = ['#000000', '#FFFFFF', '#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#FF00FF',
                 '#00FFFF', '#000000', '#FFFFFF', '#FF0000', '#00FF00', '#0000FF', '#FFFF00',
                 '#FF00FF', '#00FFFF', '#800000', '#008000', '#000080', '#808000', '#800080',
                 '#008080', '#C0C0C0', '#808080'];

/** A colour as the app wants it: "#RRGGBB", or null when the file says "no colour". */
function colour(tag, theme) {
  if (!tag) return null;
  const a = tag.attrs || tag;
  if (a.auto === '1') return null;
  if (a.rgb) {
    const hex = String(a.rgb).replace(/^#/, '');
    // ARGB: the alpha byte is dropped — a spreadsheet fill is never half-transparent.
    const rgb = hex.length === 8 ? hex.slice(2) : hex;
    return '#' + rgb.toUpperCase();
  }
  if (a.theme !== undefined) {
    const base = theme[+a.theme] || null;
    return base && a.tint ? tint(base, +a.tint) : base;
  }
  if (a.indexed !== undefined) return INDEXED[+a.indexed] || null;
  return null;
}

/** A theme colour lightened or darkened, the way the file means it to be. */
function tint(hex, amount) {
  if (!amount) return hex;
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => {
    const out = amount > 0 ? v * (1 - amount) + 255 * amount : v * (1 + amount);
    return Math.max(0, Math.min(255, Math.round(out)));
  });
  return '#' + ch.map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase();
}

// The number formats every spreadsheet knows without being told.
const BUILTIN_FMT = {
  0: 'General', 1: '0', 2: '0.00', 3: '#,##0', 4: '#,##0.00', 9: '0%', 10: '0.00%',
  11: '0.00E+00', 12: '# ?/?', 13: '# ??/??', 14: 'mm-dd-yy', 15: 'd-mmm-yy', 16: 'd-mmm',
  17: 'mmm-yy', 18: 'h:mm AM/PM', 19: 'h:mm:ss AM/PM', 20: 'h:mm', 21: 'h:mm:ss',
  22: 'm/d/yy h:mm', 37: '#,##0 ;(#,##0)', 38: '#,##0 ;[Red](#,##0)',
  39: '#,##0.00;(#,##0.00)', 40: '#,##0.00;[Red](#,##0.00)', 45: 'mm:ss', 46: '[h]:mm:ss',
  47: 'mmss.0', 48: '##0.0E+0', 49: '@',
};

/** Does this format code mean a date? Enough to know whether a serial number is a day. */
export function isDateFormat(code) {
  if (!code || code === 'General') return false;
  const bare = code.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '');
  return /[dmyhs]/i.test(bare) && /[dmy]/i.test(bare);
}

const ALIGN_H = { left: 'left', center: 'center', right: 'right', justify: 'justify',
                  centerContinuous: 'center', distributed: 'justify', general: null };

/**
 * styles.xml, flattened. A cell's `s` is an index into cellXfs, and what comes back here is
 * one object per index with everything already resolved — no second lookup at draw time.
 */
function readStyles(xml, theme) {
  const empty = { styles: [{}], dxfs: [], numFmts: {} };
  if (!xml) return empty;

  const numFmts = { ...BUILTIN_FMT };
  for (const t of tags(xml, 'numFmt')) numFmts[+t.attrs.numFmtId] = t.attrs.formatCode;

  const section = name => {
    const m = new RegExp('<' + name + '\\b[^>]*>([\\s\\S]*?)</' + name + '>').exec(xml);
    return m ? m[1] : '';
  };

  const fonts = tags(section('fonts'), 'font').map(f => {
    const sz = first(f.body, 'sz'), name = first(f.body, 'name') || first(f.body, 'rFont');
    const col = first(f.body, 'color');
    return {
      ...(name && name.attrs.val ? { name: name.attrs.val } : {}),
      ...(sz ? { size: +sz.attrs.val } : {}),
      ...(/<b\b[^>]*\/?>/.test(f.body) && !/<b val="0"/.test(f.body) ? { bold: true } : {}),
      ...(/<i\b[^>]*\/?>/.test(f.body) && !/<i val="0"/.test(f.body) ? { italic: true } : {}),
      ...(/<u\b[^>]*\/?>/.test(f.body) ? { underline: true } : {}),
      ...(/<strike\b[^>]*\/?>/.test(f.body) ? { strike: true } : {}),
      ...(colour(col, theme) ? { color: colour(col, theme) } : {}),
    };
  });

  const fills = tags(section('fills'), 'fill').map(f => {
    const pat = first(f.body, 'patternFill');
    if (!pat || pat.attrs.patternType === 'none') return {};
    const fg = colour(first(pat.body, 'fgColor'), theme);
    const bg = colour(first(pat.body, 'bgColor'), theme);
    // A solid fill puts its colour in fgColor, which reads backwards and catches everyone out.
    const fill = pat.attrs.patternType === 'solid' ? fg : (fg || bg);
    return fill ? { fill } : {};
  });

  const SIDES = ['left', 'right', 'top', 'bottom'];
  const borders = tags(section('borders'), 'border').map(b => {
    const out = {};
    for (const side of SIDES) {
      const el = first(b.body, side);
      if (!el || !el.attrs.style) continue;
      out[side] = { style: el.attrs.style, ...(colour(first(el.body, 'color'), theme)
        ? { color: colour(first(el.body, 'color'), theme) } : {}) };
    }
    return Object.keys(out).length ? out : {};
  });

  const xfBody = section('cellXfs');
  const styles = tags(xfBody, 'xf').map(xf => {
    const a = xf.attrs;
    const out = {};
    const fmt = numFmts[+a.numFmtId || 0];
    if (a.applyNumberFormat !== '0' && fmt && fmt !== 'General') out.numFmt = fmt;
    const font = fonts[+a.fontId || 0];
    if (font && Object.keys(font).length) Object.assign(out, font);
    const fill = fills[+a.fillId || 0];
    if (fill && fill.fill) out.fill = fill.fill;
    const border = borders[+a.borderId || 0];
    if (border && Object.keys(border).length) out.border = border;
    const al = first(xf.body, 'alignment');
    if (al) {
      const h = ALIGN_H[al.attrs.horizontal];
      if (h) out.align = h;
      if (al.attrs.vertical && al.attrs.vertical !== 'bottom') out.valign = al.attrs.vertical;
      if (al.attrs.wrapText === '1') out.wrap = true;
      if (al.attrs.textRotation && +al.attrs.textRotation) out.rotate = +al.attrs.textRotation;
      if (al.attrs.indent && +al.attrs.indent) out.indent = +al.attrs.indent;
    }
    return out;
  });

  // The differential formats a conditional rule applies on top of a cell's own style.
  const dxfs = tags(section('dxfs'), 'dxf').map(d => {
    const out = {};
    const fillEl = first(d.body, 'patternFill');
    if (fillEl) {
      const c = colour(first(fillEl.body, 'bgColor'), theme) || colour(first(fillEl.body, 'fgColor'), theme);
      if (c) out.fill = c;
    }
    const fontEl = first(d.body, 'font');
    if (fontEl) {
      const c = colour(first(fontEl.body, 'color'), theme);
      if (c) out.color = c;
      if (/<b\b[^>]*\/?>/.test(fontEl.body)) out.bold = true;
      if (/<i\b[^>]*\/?>/.test(fontEl.body)) out.italic = true;
    }
    return out;
  });

  return { styles: styles.length ? styles : [{}], dxfs, numFmts };
}

/* --------------------------------------------------------------------------- formula repair */

const DUMMY = /^IFERROR\(__xludf\.DUMMYFUNCTION\(\s*"((?:[^"]|"")*)"\s*\)\s*,([\s\S]*)\)$/;

/**
 * A Sheets-only function, as Google exports it. Gives back the formula it wrapped — or null
 * when even that was dropped and all Google left behind was the word COMPUTED_VALUE.
 */
export function readDummy(formula) {
  const m = DUMMY.exec(String(formula || '').trim());
  if (!m) return null;
  const inner = m[1].replace(/""/g, '"').trim();
  const bare = inner.replace(/^"+|"+$/g, '');
  return { google: bare === 'COMPUTED_VALUE' ? null : inner, fallback: m[2] };
}

/**
 * A formula moved from where it was written to where it is used.
 *
 * Only relative parts move, string literals and quoted sheet names are stepped over whole, and
 * a run of letters followed by "(" is a function rather than a column. Column-only ranges
 * (B:B) are left alone; in these files every one of them is already absolute.
 */
export function shiftFormula(text, dr, dc) {
  if (!text || (!dr && !dc)) return text || '';
  let out = '';
  for (let i = 0; i < text.length;) {
    const ch = text[i];
    if (ch === '"') {                              // a string literal, including "" inside it
      let j = i + 1;
      while (j < text.length) {
        if (text[j] === '"') { if (text[j + 1] === '"') j += 2; else { j++; break; } }
        else j++;
      }
      out += text.slice(i, j); i = j; continue;
    }
    if (ch === "'") {                              // a quoted sheet name
      let j = i + 1;
      while (j < text.length) {
        if (text[j] === "'") { if (text[j + 1] === "'") j += 2; else { j++; break; } }
        else j++;
      }
      out += text.slice(i, j); i = j; continue;
    }
    const m = /^(\$?)([A-Z]{1,3})(\$?)(\d{1,7})/.exec(text.slice(i));
    if (m) {
      const after = text[i + m[0].length];
      const before = out[out.length - 1];
      const isRef = after !== '(' && !/[A-Za-z0-9_.]/.test(after || '')
                 && !/[A-Za-z0-9_.$]/.test(before || '');
      if (isRef) {
        const c = m[1] ? colIndex(m[2]) : colIndex(m[2]) + dc;
        const r = m[3] ? +m[4] : +m[4] + dr;
        out += (c < 0 || r < 1)
          ? '#REF!'
          : m[1] + colName(c) + m[3] + r;
        i += m[0].length;
        continue;
      }
    }
    out += ch; i++;
  }
  return out;
}

/* -------------------------------------------------------------------------------- one sheet */

const VAL = /<v>([\s\S]*?)<\/v>/;
const INLINE = /<is>([\s\S]*?)<\/is>/;

function readSheet(xml, shared, ctx) {
  const sheet = {
    cells: [], merges: [], cols: [], rows: [], validations: [], condFmts: [],
    hyperlinks: [], images: [], frozen: null, autoFilter: null, tabColor: null,
    defaults: {}, dim: { rows: 0, cols: 0 },
  };
  if (!xml) return sheet;

  const props = first(xml, 'sheetPr');
  if (props) {
    const tc = first(props.body, 'tabColor');
    if (tc) sheet.tabColor = colour(tc, ctx.theme);
  }
  const fmt = first(xml, 'sheetFormatPr');
  if (fmt) {
    if (fmt.attrs.defaultColWidth) sheet.defaults.colWidth = +fmt.attrs.defaultColWidth;
    if (fmt.attrs.defaultRowHeight) sheet.defaults.rowHeight = +fmt.attrs.defaultRowHeight;
  }
  const pane = first(xml, 'pane');
  if (pane && pane.attrs.state === 'frozen') {
    sheet.frozen = { rows: +(pane.attrs.ySplit || 0), cols: +(pane.attrs.xSplit || 0) };
  }
  for (const c of tags(xml, 'col')) {
    const a = c.attrs;
    const col = { min: +a.min - 1, max: +a.max - 1 };
    if (a.customWidth === '1' && a.width) col.width = Math.round(+a.width * 7.5);
    if (a.hidden === '1') col.hidden = true;
    if (a.style && +a.style) col.style = +a.style;
    if (col.width !== undefined || col.hidden || col.style !== undefined) sheet.cols.push(col);
  }
  for (const m of tags(xml, 'mergeCell')) if (m.attrs.ref) sheet.merges.push(m.attrs.ref);
  const af = first(xml, 'autoFilter');
  if (af && af.attrs.ref) sheet.autoFilter = af.attrs.ref;

  for (const dv of tags(xml, 'dataValidation')) {
    const f1 = first(dv.body, 'formula1'), f2 = first(dv.body, 'formula2');
    sheet.validations.push({
      sqref: dv.attrs.sqref, type: dv.attrs.type || 'any',
      ...(dv.attrs.operator ? { operator: dv.attrs.operator } : {}),
      ...(dv.attrs.allowBlank === '1' ? { allowBlank: true } : {}),
      ...(dv.attrs.showDropDown === '0' ? { showDropDown: true } : {}),
      ...(f1 ? { formula1: unescapeXml(f1.body) } : {}),
      ...(f2 ? { formula2: unescapeXml(f2.body) } : {}),
    });
  }

  for (const cf of tags(xml, 'conditionalFormatting')) {
    const rules = tags(cf.body, 'cfRule').map(r => {
      const a = r.attrs;
      const out = { type: a.type, priority: +(a.priority || 0) };
      if (a.operator) out.operator = a.operator;
      if (a.text) out.text = a.text;
      if (a.dxfId !== undefined) out.style = ctx.dxfs[+a.dxfId] || {};
      const fs = tags(r.body, 'formula').map(f => unescapeXml(f.body));
      if (fs.length) out.formulas = fs;
      const cs = first(r.body, 'colorScale');
      if (cs) {
        out.colors = tags(cs.body, 'color').map(c => colour(c, ctx.theme));
        out.stops = tags(cs.body, 'cfvo').map(v => ({ type: v.attrs.type, val: v.attrs.val }));
      }
      const db = first(r.body, 'dataBar');
      if (db) out.bar = colour(first(db.body, 'color'), ctx.theme);
      return out;
    });
    if (rules.length) sheet.condFmts.push({ sqref: cf.attrs.sqref, rules });
  }

  for (const h of tags(xml, 'hyperlink')) {
    const target = h.attrs['r:id'] ? (ctx.rels[h.attrs['r:id']] || {}).target : null;
    sheet.hyperlinks.push({ ref: h.attrs.ref, ...(target ? { url: target } : {}),
                            ...(h.attrs.location ? { location: h.attrs.location } : {}) });
  }

  // Row heights and hidden rows, before the cells so a row's own style is known.
  const rowRe = /<row\b([^>]*?)(?:\/>|>)/g;
  let rm;
  while ((rm = rowRe.exec(xml))) {
    const a = attrs(rm[1]);
    const r = +a.r - 1;
    if (!(r >= 0)) continue;
    const row = { r };
    if (a.customHeight === '1' && a.ht) row.height = Math.round(+a.ht * 1.333);
    if (a.hidden === '1') row.hidden = true;
    if (a.customFormat === '1' && a.s) row.style = +a.s;
    if (row.height !== undefined || row.hidden || row.style !== undefined) sheet.rows.push(row);
  }

  // Shared formulas: the masters first, so a member can be shifted from wherever it sits.
  const masters = {};
  const fRe = /<f\b([^>]*?)(?:\/>|>([\s\S]*?)<\/f>)/g;
  const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
  let cm;
  while ((cm = cellRe.exec(xml))) {
    const body = cm[2];
    if (!body || body.indexOf('t="shared"') === -1) continue;
    const a = attrs(cm[1]);
    fRe.lastIndex = 0;
    const f = fRe.exec(body);
    if (!f) continue;
    const fa = attrs(f[1]);
    if (fa.t === 'shared' && fa.si !== undefined && f[2]) {
      masters[fa.si] = { at: parseRef(a.r), text: unescapeXml(f[2]) };
    }
  }

  cellRe.lastIndex = 0;
  let maxRow = 0, maxCol = 0;
  while ((cm = cellRe.exec(xml))) {
    const a = attrs(cm[1]);
    const at = parseRef(a.r);
    if (!at) continue;
    const body = cm[2] || '';
    const s = a.s !== undefined ? +a.s : 0;

    let v = null, t = a.t || 'n', formula = null, note = null;

    if (body) {
      fRe.lastIndex = 0;
      const f = fRe.exec(body);
      if (f) {
        const fa = attrs(f[1]);
        if (f[2]) formula = unescapeXml(f[2]);
        else if (fa.t === 'shared' && masters[fa.si]) {
          const m = masters[fa.si];
          formula = shiftFormula(m.text, at.r - m.at.r, at.c - m.at.c);
        }
        if (fa.t === 'array') note = 'array';
      }
      const vm = VAL.exec(body);
      if (vm) v = unescapeXml(vm[1]);
      else if (t === 'inlineStr') {
        const im = INLINE.exec(body);
        if (im) {
          let text = '';
          const tRe = /<t[^>]*>([\s\S]*?)<\/t>/g;
          let tm;
          while ((tm = tRe.exec(im[1]))) text += unescapeXml(tm[1]);
          v = text;
        }
      }
    }

    // A Sheets-only function: keep the value it computed, keep the formula as a note.
    if (formula && formula.indexOf('__xludf') !== -1) {
      const d = readDummy(formula);
      if (d) {
        note = d.google ? 'google:' + d.google : 'google';
        formula = null;
        ctx.report.google++;
      }
    }

    let value = v;
    if (t === 's') { value = shared[+v] !== undefined ? shared[+v] : ''; t = 'str'; }
    else if (t === 'b') { value = v === '1'; }
    else if (t === 'e') { ctx.report.errors++; }
    else if (t === 'str') { /* a formula's text result, already a string */ }
    else if (v !== null && v !== '') { const n = +v; value = Number.isFinite(n) ? n : v; t = 'n'; }
    else { value = null; }

    // An empty cell is worth keeping only when something is drawn on it, or when it carries a
    // format that will matter the moment somebody types there. Google's export pads the used
    // range with styled blanks that paint nothing at all — two cells in five in these files.
    if (value === null && !formula && !note) {
      if (!ctx.paints(s)) continue;
      sheet.cells.push([at.r, at.c, null, '', null, s]);
    } else {
      sheet.cells.push([at.r, at.c, value, t, formula, s, note]);
    }
    if (at.r > maxRow) maxRow = at.r;
    if (at.c > maxCol) maxCol = at.c;
    if (formula) ctx.report.formulas++;
  }

  sheet.dim = { rows: maxRow + 1, cols: maxCol + 1 };
  return sheet;
}

/* ------------------------------------------------------------------------------ the drawing */

function readDrawing(xml, mediaFor) {
  if (!xml) return [];
  const out = [];
  for (const kind of ['twoCellAnchor', 'oneCellAnchor', 'absoluteAnchor']) {
    for (const a of tags(xml, 'xdr:' + kind).concat(tags(xml, kind))) {
      const blip = /<a:blip[^>]*r:embed="([^"]+)"/.exec(a.body);
      if (!blip) continue;
      const cell = tag => {
        const el = new RegExp('<xdr:' + tag + '>([\\s\\S]*?)</xdr:' + tag + '>').exec(a.body);
        if (!el) return null;
        const col = /<xdr:col>(\d+)<\/xdr:col>/.exec(el[1]);
        const row = /<xdr:row>(\d+)<\/xdr:row>/.exec(el[1]);
        return col && row ? { r: +row[1], c: +col[1] } : null;
      };
      out.push({ from: cell('from'), to: cell('to'), media: mediaFor(blip[1]) || null });
    }
  }
  return out;
}

/* ------------------------------------------------------------------------------- the reader */

function readRels(xml) {
  const out = {};
  if (!xml) return out;
  for (const r of tags(xml, 'Relationship')) {
    out[r.attrs.Id] = { target: r.attrs.Target, type: r.attrs.Type };
  }
  return out;
}

const resolve = (base, target) => {
  if (!target) return null;
  if (target.startsWith('/')) return target.slice(1);
  const parts = (base + '/' + target).split('/');
  const stack = [];
  for (const p of parts) {
    if (p === '.' || p === '') continue;
    if (p === '..') stack.pop(); else stack.push(p);
  }
  return stack.join('/');
};

/**
 * Read a workbook.
 *
 * `want(name, index)` decides which tabs are read; the rest are listed but left compressed,
 * which matters for the files here where one tab can be most of the workbook.
 */
export async function readBook(input, { want = () => true, media = false } = {}) {
  const zip = await unzipAll(input);
  const text = p => (zip[p] ? dec.decode(zip[p]) : '');

  const wbXml = text('xl/workbook.xml');
  const wbRels = readRels(text('xl/_rels/workbook.xml.rels'));
  const theme = readTheme(text('xl/theme/theme1.xml'));
  const shared = readSharedStrings(text('xl/sharedStrings.xml'));
  const { styles, dxfs } = readStyles(text('xl/styles.xml'), theme);

  // Which style indexes draw something on an empty cell, worked out once.
  const paintsAt = styles.map(st => !!(st.fill || st.border || st.numFmt));
  const paints = i => paintsAt[i] === true;

  const report = { formulas: 0, google: 0, errors: 0, skipped: [], images: 0, notes: [] };
  const book = { sheets: [], styles, report, definedNames: [] };

  for (const dn of tags(wbXml, 'definedName')) {
    book.definedNames.push({ name: dn.attrs.name, ref: unescapeXml(dn.body) });
  }

  const sheetTags = [...wbXml.matchAll(/<sheet\b([^>]*?)\/?>/g)].map(m => attrs(m[1]));
  sheetTags.forEach((meta, i) => {
    const rel = wbRels[meta['r:id']];
    const path = rel ? resolve('xl', rel.target) : `xl/worksheets/sheet${i + 1}.xml`;
    const name = meta.name || 'Sheet' + (i + 1);
    const hidden = meta.state === 'hidden' || meta.state === 'veryHidden';

    if (!want(name, i)) {
      book.sheets.push({ name, idx: i, hidden, skipped: true, cells: [] });
      report.skipped.push(name);
      return;
    }

    const xml = text(path);
    const relsPath = path.replace(/([^/]+)$/, '_rels/$1.rels');
    const rels = readRels(text(relsPath));
    const sheet = readSheet(xml, shared, { theme, dxfs, rels, report, paints });
    sheet.name = name;
    sheet.idx = i;
    sheet.hidden = hidden;

    const dr = first(xml, 'drawing');
    if (dr && dr.attrs['r:id'] && rels[dr.attrs['r:id']]) {
      const drPath = resolve(path.replace(/\/[^/]+$/, ''), rels[dr.attrs['r:id']].target);
      const drRels = readRels(text(drPath.replace(/([^/]+)$/, '_rels/$1.rels')));
      sheet.images = readDrawing(text(drPath), id => {
        const t = drRels[id];
        if (!t) return null;
        const p = resolve(drPath.replace(/\/[^/]+$/, ''), t.target);
        const bytes = zip[p];
        if (!bytes) return null;
        report.images++;
        return media ? { path: p, bytes } : { path: p, bytes: null, size: bytes.length };
      }).filter(x => x.media);
    }

    book.sheets.push(sheet);
  });

  return book;
}

/** Just the tab names, without decompressing a single sheet. */
export async function listSheets(input) {
  const zip = await unzipAll(input);
  const xml = zip['xl/workbook.xml'] ? dec.decode(zip['xl/workbook.xml']) : '';
  return [...xml.matchAll(/<sheet\b([^>]*?)\/?>/g)].map(m => {
    const a = attrs(m[1]);
    return { name: a.name, hidden: a.state === 'hidden' || a.state === 'veryHidden' };
  });
}
