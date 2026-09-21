/**
 * An imported tab, handed to the spreadsheet engine and taken back again.
 *
 * Univer keeps a workbook as a snapshot: cells by row and column, a pool of styles they point
 * at, merges, widths, heights and a freeze. That is close enough to how this app stores a sheet
 * that the two can be translated without losing the parts that matter — values, formulas, fills,
 * fonts, borders, alignment, number formats.
 *
 * Coming back, styles are *appended* to the file's pool rather than replacing it. Every other
 * tab in the workbook points into that same pool by index, so rewriting it would repaint
 * thirty-five other sheets.
 */

// Univer's own enums, written out rather than imported: this module is loaded long before the
// five-megabyte editor chunk is, and it should not drag it in.
const H_ALIGN = { left: 1, center: 2, right: 3, justify: 2 };
const V_ALIGN = { top: 1, center: 2, middle: 2, bottom: 3 };
const H_BACK = { 1: 'left', 2: 'center', 3: 'right' };
const V_BACK = { 1: 'top', 2: 'center', 3: 'bottom' };
const BORDER = { hair: 1, thin: 1, medium: 2, dashed: 3, dotted: 4, thick: 5, double: 6 };
const BORDER_BACK = { 1: 'thin', 2: 'medium', 3: 'dashed', 4: 'dotted', 5: 'thick', 6: 'double' };
const SIDES = { top: 't', bottom: 'b', left: 'l', right: 'r' };
const SIDES_BACK = { t: 'top', b: 'bottom', l: 'left', r: 'right' };

const rgb = hex => (hex ? { rgb: hex } : undefined);
const unrgb = c => (c && typeof c === 'object' && c.rgb ? String(c.rgb).toUpperCase() : null);

/** One of this app's styles, as Univer wants it. */
export function toUniverStyle(style) {
  if (!style) return null;
  const out = {};
  if (style.fill) out.bg = rgb(style.fill);
  if (style.color) out.cl = rgb(style.color);
  if (style.bold) out.bl = 1;
  if (style.italic) out.it = 1;
  if (style.underline) out.ul = { s: 1 };
  if (style.strike) out.st = { s: 1 };
  if (style.size) out.fs = style.size;
  if (style.name) out.ff = style.name;
  if (style.align) out.ht = H_ALIGN[style.align] || undefined;
  if (style.valign) out.vt = V_ALIGN[style.valign] || undefined;
  if (style.wrap) out.tb = 3;
  if (style.numFmt) out.n = { pattern: style.numFmt };
  if (style.border) {
    const bd = {};
    for (const [side, spec] of Object.entries(style.border)) {
      if (!SIDES[side] || !spec) continue;
      bd[SIDES[side]] = { s: BORDER[spec.style] || 1, cl: rgb(spec.color || '#000000') };
    }
    if (Object.keys(bd).length) out.bd = bd;
  }
  return Object.keys(out).length ? out : null;
}

/** And back again, in this app's shape. */
export function fromUniverStyle(u) {
  if (!u || typeof u !== 'object') return {};
  const out = {};
  const bg = unrgb(u.bg);
  if (bg) out.fill = bg;
  const cl = unrgb(u.cl);
  if (cl) out.color = cl;
  if (u.bl) out.bold = true;
  if (u.it) out.italic = true;
  if (u.ul && u.ul.s) out.underline = true;
  if (u.st && u.st.s) out.strike = true;
  if (u.fs) out.size = u.fs;
  if (u.ff) out.name = u.ff;
  if (H_BACK[u.ht]) out.align = H_BACK[u.ht];
  if (V_BACK[u.vt] && V_BACK[u.vt] !== 'bottom') out.valign = V_BACK[u.vt];
  if (u.tb === 3) out.wrap = true;
  if (u.n && u.n.pattern) out.numFmt = u.n.pattern;
  if (u.bd) {
    const border = {};
    for (const [key, spec] of Object.entries(u.bd)) {
      if (!SIDES_BACK[key] || !spec) continue;
      border[SIDES_BACK[key]] = {
        style: BORDER_BACK[spec.s] || 'thin',
        ...(unrgb(spec.cl) ? { color: unrgb(spec.cl) } : {}),
      };
    }
    if (Object.keys(border).length) out.border = border;
  }
  return out;
}

/** The whole tab, as a Univer workbook of one sheet. */
export function toUniver({ sheet, styles, meta, cells }) {
  const sheetId = 'sh';
  const cellData = {};
  let maxRow = 0, maxCol = 0;

  for (const cell of cells) {
    const [r, c, value, type, formula, styleIndex] = cell;
    if (r > maxRow) maxRow = r;
    if (c > maxCol) maxCol = c;
    const one = {};
    if (value !== null && value !== undefined && value !== '') {
      one.v = value;
      // 1 number, 2 string, 3 boolean, 4 error — Univer's CellValueType.
      one.t = type === 'n' ? 1 : type === 'b' ? 3 : type === 'e' ? 4 : 2;
    }
    if (formula) one.f = '=' + formula;
    if (styleIndex) one.s = 's' + styleIndex;
    if (!Object.keys(one).length) continue;
    (cellData[r] || (cellData[r] = {}))[c] = one;
  }

  const pool = {};
  styles.forEach((style, i) => {
    const u = toUniverStyle(style);
    if (u) pool['s' + i] = u;
  });

  const columnData = {};
  for (const col of (meta && meta.cols) || []) {
    for (let c = Math.max(0, col.min); c <= col.max && c <= maxCol + 8; c++) {
      columnData[c] = col.hidden ? { hd: 1 } : { w: col.width || 100 };
    }
  }
  const rowData = {};
  for (const row of (meta && meta.rows) || []) {
    if (row.r < 0) continue;
    rowData[row.r] = row.hidden ? { hd: 1 } : { h: row.height || 22 };
  }

  const mergeData = [];
  for (const ref of (meta && meta.merges) || []) {
    const [a, b] = String(ref).split(':');
    const from = refToRC(a), to = refToRC(b || a);
    if (!from || !to) continue;
    mergeData.push({ startRow: from.r, endRow: to.r, startColumn: from.c, endColumn: to.c });
  }

  const freeze = sheet.frozen
    ? { xSplit: sheet.frozen.cols || 0, ySplit: sheet.frozen.rows || 0,
        startRow: sheet.frozen.rows || 0, startColumn: sheet.frozen.cols || 0 }
    : undefined;

  return {
    id: 'kartz-file',
    name: sheet.name,
    sheetOrder: [sheetId],
    styles: pool,
    sheets: {
      [sheetId]: {
        id: sheetId,
        name: sheet.name,
        rowCount: Math.max(maxRow + 40, sheet.rows || 0, 60),
        columnCount: Math.max(maxCol + 6, sheet.cols || 0, 20),
        cellData, mergeData, columnData, rowData,
        ...(freeze ? { freeze } : {}),
        defaultColumnWidth: (sheet.defaults && sheet.defaults.colWidth) || 100,
        defaultRowHeight: (sheet.defaults && sheet.defaults.rowHeight) || 22,
      },
    },
  };
}

function refToRC(ref) {
  const m = /^\$?([A-Z]+)\$?(\d+)$/.exec(String(ref || '').trim().toUpperCase());
  if (!m) return null;
  let c = 0;
  for (const ch of m[1]) c = c * 26 + (ch.charCodeAt(0) - 64);
  return { r: +m[2] - 1, c: c - 1 };
}

/**
 * The snapshot the engine hands back, as cells this app can store.
 *
 * `styles` goes in as the file's current pool and comes back possibly longer: a style the user
 * made in the editor is appended, never substituted, so the indices every other tab uses still
 * mean what they meant.
 */
export function fromUniver(snapshot, styles) {
  const pool = styles.slice();
  const keyOf = style => JSON.stringify(style, Object.keys(style).sort());
  const known = new Map(pool.map((s, i) => [keyOf(s || {}), i]));
  const indexFor = style => {
    const clean = style || {};
    if (!Object.keys(clean).length) return 0;
    const key = keyOf(clean);
    if (known.has(key)) return known.get(key);
    pool.push(clean);
    known.set(key, pool.length - 1);
    return pool.length - 1;
  };

  const first = snapshot.sheetOrder && snapshot.sheetOrder[0];
  const ws = (snapshot.sheets && (snapshot.sheets[first] || Object.values(snapshot.sheets)[0])) || {};
  const uStyles = snapshot.styles || {};

  const cells = [];
  let rows = 0, cols = 0;
  for (const [rowKey, row] of Object.entries(ws.cellData || {})) {
    const r = +rowKey;
    for (const [colKey, cell] of Object.entries(row || {})) {
      const c = +colKey;
      if (!cell) continue;
      const raw = cell.s;
      const style = typeof raw === 'string' ? uStyles[raw] : (raw && typeof raw === 'object' ? raw : null);
      const idx = typeof raw === 'string' && /^s\d+$/.test(raw) && +raw.slice(1) < styles.length
        ? +raw.slice(1)                                   // untouched: the index it came in as
        : indexFor(fromUniverStyle(style));
      const value = cell.v === undefined ? null : cell.v;
      const formula = cell.f ? String(cell.f).replace(/^=/, '') : null;
      if (value === null && !formula && !idx) continue;
      const type = value === null ? '' : cell.t === 1 || typeof value === 'number' ? 'n'
        : cell.t === 3 ? 'b' : cell.t === 4 ? 'e' : 'str';
      cells.push([r, c, value, type, formula, idx]);
      if (r + 1 > rows) rows = r + 1;
      if (c + 1 > cols) cols = c + 1;
    }
  }
  cells.sort((a, b) => a[0] - b[0] || a[1] - b[1]);

  const merges = (ws.mergeData || []).map(m =>
    rcToRef(m.startRow, m.startColumn) + ':' + rcToRef(m.endRow, m.endColumn));

  return { cells, rows, cols, styles: pool, merges };
}

function rcToRef(r, c) {
  let s = '';
  for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s + (r + 1);
}
