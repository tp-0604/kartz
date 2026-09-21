/**
 * Turning a workbook that has been read into something the database can hold.
 *
 * Three questions, in order:
 *
 *   What kind of sheet is this? A form's responses and a calendar drawn in merged cells are
 *   both grids, and only one of them has rows anybody can query. detectShape decides, and
 *   whoever imported can overrule it afterwards — the shape is a stored field, not a verdict.
 *
 *   Where is the table? A sheet rarely starts at A1: there are titles, notes and a gap before
 *   the header row. findTable looks for the first row that reads like headings with a body
 *   under it, and reports how sure it is.
 *
 *   How does the grid travel? In bands of five hundred rows, gzipped here rather than on the
 *   Worker, because the browser doing the reading has the spare time and the Worker does not.
 *
 * Nothing in this file knows what the data is about, which is the whole point. The only thing
 * it recognises is the difference between a table and a drawing.
 */
import { gzipSync, strToU8 } from 'fflate';
import { colName } from './xlsxBook.js';

export const BAND = 500;

/* ----------------------------------------------------------------------------- the shape */

const isText = c => c[3] === 'str' || typeof c[2] === 'string';
const hasValue = c => c[2] !== null && c[2] !== '';

/**
 * Where a header row is, and what it names.
 *
 * A header is a row of at least two text cells with a body of rows under it filling the same
 * columns. The first one found wins, because a sheet that starts with a title and a blank line
 * still means its third row.
 */
export function findTable(cells, { minBody = 3 } = {}) {
  if (!cells.length) return null;
  const byRow = new Map();
  for (const c of cells) {
    if (!hasValue(c)) continue;
    let row = byRow.get(c[0]);
    if (!row) byRow.set(c[0], (row = []));
    row.push(c);
  }
  const rows = [...byRow.keys()].sort((a, b) => a - b);
  if (!rows.length) return null;

  for (let i = 0; i < rows.length && i < 40; i++) {
    const head = byRow.get(rows[i]).filter(isText);
    if (head.length < 2) continue;
    const cols = head.map(c => c[1]).sort((a, b) => a - b);
    const width = cols[cols.length - 1] - cols[0] + 1;
    if (width > head.length * 3) continue;                 // headings too scattered to be a row

    // How many of the rows under it fill the same columns?
    const want = new Set(cols);
    let body = 0, last = rows[i];
    for (let j = i + 1; j < rows.length; j++) {
      const filled = byRow.get(rows[j]).filter(c => hasValue(c) && want.has(c[1])).length;
      // A wide sheet's rows are sparse — seven weeks of sign-ups side by side fill eight of
      // sixty columns — so a body row is one that fills a couple of the header's columns.
      if (filled >= Math.max(2, Math.ceil(cols.length * 0.2))) { body++; last = rows[j]; }
      else if (rows[j] - last > 3) break;                  // a gap of blank rows ends the table
    }
    if (body < minBody) continue;

    const headers = new Map();
    for (const c of head) headers.set(c[1], String(c[2]));
    return {
      headerRow: rows[i],
      firstRow: rows[i] + 1,
      lastRow: last,
      firstCol: cols[0],
      lastCol: cols[cols.length - 1],
      rows: body,
      columns: cols.map(c => ({ col: c, header: headers.get(c) || colName(c) })),
    };
  }
  return null;
}

/**
 * table, layout, mixed or empty.
 *
 * A table is a sheet whose cells are mostly its table. A layout is a sheet where most of what
 * is there is drawn rather than written — merged cells, fills, blanks that are painted. Mixed
 * is everything else, and is the honest answer for a planning sheet with a lookup table beside
 * a map made of coloured cells.
 */
export function detectShape(sheet, table) {
  const cells = sheet.cells || [];
  if (!cells.length) return 'empty';
  const valued = cells.filter(hasValue).length;
  if (!valued) return 'layout';

  const painted = cells.length - valued;
  const merges = (sheet.merges || []).length;
  const inTable = table
    ? cells.filter(c => hasValue(c) && c[0] >= table.headerRow && c[0] <= table.lastRow
                     && c[1] >= table.firstCol && c[1] <= table.lastCol).length
    : 0;

  const tabular = valued ? inTable / valued : 0;
  const drawn = cells.length ? painted / cells.length : 0;

  // A small sheet with a banner merged across it is a drawing with words in it — a month
  // calendar, a squad map — however neatly its rows line up underneath.
  const banner = (sheet.merges || []).some(ref => {
    const m = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(ref || '');
    return m && m[1] !== m[3] && m[3].length >= m[1].length;
  });
  if (banner && valued < 500) return 'layout';

  if (tabular >= 0.8 && merges <= 4) return 'table';
  if (drawn >= 0.5 || merges >= 20) return 'layout';
  if (tabular >= 0.35) return 'mixed';
  return merges || drawn >= 0.25 ? 'layout' : 'mixed';
}

/** The table's rows as objects, keyed by heading — what the analyst and the filters read. */
export function projectRows(cells, table, { max = 20000 } = {}) {
  if (!table) return [];
  const keys = new Map();
  const used = new Set();
  for (const c of table.columns) {
    let key = String(c.header || colName(c.col)).trim().replace(/\s+/g, ' ') || colName(c.col);
    if (used.has(key)) { let n = 2; while (used.has(key + ' ' + n)) n++; key = key + ' ' + n; }
    used.add(key);
    keys.set(c.col, key);
  }
  const rows = new Map();
  for (const c of cells) {
    if (c[0] < table.firstRow || c[0] > table.lastRow) continue;
    if (!keys.has(c[1]) || !hasValue(c)) continue;
    let row = rows.get(c[0]);
    if (!row) rows.set(c[0], (row = {}));
    row[keys.get(c[1])] = c[2];
  }
  return [...rows.entries()]
    .sort((a, b) => a[0] - b[0])
    .slice(0, max)
    .map(([r, data], idx) => ({ idx, r, data }));
}

/* ------------------------------------------------------------------------------ the bands */

const b64 = bytes => {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};

/** A sheet's cells, cut into bands and compressed, ready to be sent one request at a time. */
export function packBands(cells) {
  const bands = new Map();
  for (const c of cells) {
    const band = Math.floor(c[0] / BAND);
    let list = bands.get(band);
    if (!list) bands.set(band, (list = []));
    list.push(c);
  }
  return [...bands.entries()].sort((a, b) => a[0] - b[0]).map(([band, list]) => {
    const bytes = gzipSync(strToU8(JSON.stringify(list)), { level: 6 });
    return { band, count: list.length, bytes: bytes.length, cells: b64(bytes) };
  });
}

/* ----------------------------------------------------------------------------- the pictures */

const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');

/** A picture is known by the hash of its bytes, so the same screenshot is stored once. */
export async function hashBytes(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return hex(digest).slice(0, 40);
}

/* --------------------------------------------------------------------------------- the plan */

const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
               webp: 'image/webp', bmp: 'image/bmp', emf: 'image/emf' };

/**
 * Everything one workbook becomes: the file, its styles, a plan per sheet, the pictures to
 * upload, and the report of what came across and what did not.
 */
export async function planImport(book, { name, sourceName, folderId } = {}) {
  const sheets = [];
  const assets = new Map();
  const notes = [];
  let cells = 0, tables = 0, layouts = 0;

  for (const sheet of book.sheets) {
    if (sheet.skipped) { notes.push(`${sheet.name}: not read`); continue; }
    const table = findTable(sheet.cells || []);
    const shape = detectShape(sheet, table);
    if (shape === 'table' || shape === 'mixed') tables++;
    if (shape === 'layout') layouts++;

    const meta = {};
    if (sheet.merges && sheet.merges.length) meta.merges = sheet.merges;
    if (sheet.cols && sheet.cols.length) meta.cols = sheet.cols;
    if (sheet.rows && sheet.rows.length) meta.rows = sheet.rows;
    if (sheet.validations && sheet.validations.length) meta.validation = sheet.validations;
    if (sheet.condFmts && sheet.condFmts.length) meta.conditional = sheet.condFmts;
    if (sheet.autoFilter) meta.filter = sheet.autoFilter;
    if (sheet.hyperlinks && sheet.hyperlinks.length) meta.links = sheet.hyperlinks;

    const pictures = [];
    for (const img of sheet.images || []) {
      if (!img.media || !img.media.bytes) continue;
      const id = await hashBytes(img.media.bytes);
      if (!assets.has(id)) {
        assets.set(id, {
          id, bytes: img.media.bytes,
          mime: MIME[String(img.media.path).split('.').pop().toLowerCase()] || 'image/png',
        });
      }
      pictures.push({ asset: id, from: img.from, to: img.to });
    }
    if (pictures.length) meta.images = pictures;

    // The notes the reader left on individual cells: a Sheets-only formula, mostly.
    const marked = (sheet.cells || []).filter(c => c[6]);
    if (marked.length) {
      meta.notes = marked.slice(0, 2000).map(c => [c[0], c[1], c[6]]);
      if (marked.length > 2000) notes.push(`${sheet.name}: ${marked.length} marked cells, first 2000 kept`);
    }

    cells += (sheet.cells || []).length;
    sheets.push({
      name: sheet.name, idx: sheet.idx, shape, hidden: !!sheet.hidden,
      rows: sheet.dim.rows, cols: sheet.dim.cols,
      frozen: sheet.frozen || null, tabColor: sheet.tabColor || null,
      defaults: sheet.defaults || {},
      bands: packBands(sheet.cells || []),
      meta,
      table: table ? { ...table, project: shape !== 'layout' } : null,
    });
  }

  const r = book.report || {};
  if (r.google) notes.push(`${r.google.toLocaleString('en')} cells came from a Sheets-only function `
    + '— the value is kept, the formula is a note');
  if (r.errors) notes.push(`${r.errors} cells were already showing an error in the original`);
  if (assets.size) notes.push(`${assets.size} picture${assets.size === 1 ? '' : 's'} kept beside the sheets`);

  return {
    file: { name: name || sourceName || 'Untitled', sourceName, folderId, source: 'xlsx' },
    styles: book.styles || [{}],
    sheets,
    assets: [...assets.values()],
    report: {
      sheets: sheets.length, cells, tables, layouts,
      formulas: r.formulas || 0, google: r.google || 0, errors: r.errors || 0,
      images: assets.size, notes,
    },
  };
}

/**
 * Send a plan, one request at a time.
 *
 * `api(method, path, body)` is whatever does the talking — the browser's own client, or the
 * backload script's. Pictures are asked about before they are sent, so running an import twice
 * uploads nothing the second time. `onStep` is told what is happening, for a progress line.
 */
export async function sendImport(plan, api, { onStep = () => {}, putAsset } = {}) {
  const made = await api('POST', '/files', plan.file);
  const fileId = made.file.id;
  onStep({ step: 'file', name: plan.file.name, fileId });

  await api('PUT', `/files/${fileId}/styles`, { styles: plan.styles });

  if (plan.assets.length && putAsset) {
    const { have } = await api('POST', '/assets/have', { ids: plan.assets.map(a => a.id) });
    const known = new Set(have || []);
    for (const asset of plan.assets) {
      if (known.has(asset.id)) { onStep({ step: 'asset', id: asset.id, skipped: true }); continue; }
      await putAsset(asset);
      onStep({ step: 'asset', id: asset.id, bytes: asset.bytes.length });
    }
  }

  for (const sheet of plan.sheets) {
    const out = await api('POST', `/files/${fileId}/sheets`, {
      name: sheet.name, idx: sheet.idx, shape: sheet.shape, hidden: sheet.hidden,
      rows: sheet.rows, cols: sheet.cols, frozen: sheet.frozen,
      tabColor: sheet.tabColor, defaults: sheet.defaults,
    });
    const sheetId = out.sheet.id;
    for (const band of sheet.bands) {
      await api('PUT', `/sheets/${sheetId}/slab`,
        { band: band.band, count: band.count, cells: band.cells });
    }
    for (const [kind, json] of Object.entries(sheet.meta)) {
      await api('PUT', `/sheets/${sheetId}/meta`, { kind, json });
    }
    onStep({ step: 'sheet', name: sheet.name, cells: sheet.bands.reduce((n, b) => n + b.count, 0) });
  }

  const done = await api('POST', `/files/${fileId}/done`, { report: plan.report });
  onStep({ step: 'done', fileId, ...done });
  return { fileId, ...done };
}
