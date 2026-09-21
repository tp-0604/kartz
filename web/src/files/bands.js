/**
 * A sheet's grid, on the way down.
 *
 * The Worker hands back bands exactly as they were written: five hundred sheet rows, gzipped,
 * base64 on the wire. Unzipping them is the browser's job — it has the spare time, and it saves
 * the Worker from holding a grid in memory.
 *
 * What comes out is the cell array the reader produced in the first place:
 *
 *   [row, col, value, type, formula, styleIndex, note]
 *
 * with row and col counted from zero. A cell with a null value and a style is a painted blank,
 * which is most of what a calendar or a squad map is made of.
 */

export const BAND = 500;

const fromB64 = s => {
  const bin = atob(String(s || ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

let fflate = null;
const load = async () => (fflate || (fflate = await import('fflate')));

/** The cells of one band. */
export async function unpackBand(band) {
  const { gunzipSync, strFromU8 } = await load();
  return JSON.parse(strFromU8(gunzipSync(fromB64(band.cells))));
}

/** Every cell in the bands an answer carried, in row order. */
export async function unpackBands(answer) {
  const bands = (answer && answer.bands) || [];
  const out = [];
  for (const band of bands) out.push(...await unpackBand(band));
  out.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return out;
}

/** Which bands cover these rows. */
export const bandsFor = (from, to) => {
  const first = Math.max(0, Math.floor(from / BAND));
  const last = Math.max(first, Math.floor(to / BAND));
  const out = [];
  for (let b = first; b <= last; b++) out.push(b);
  return out;
};

/* ------------------------------------------------------------------- reading a sheet's rows */

/** "B7" from 6, 1 — for anything that has to name a cell the way a spreadsheet does. */
export function refOf(r, c) {
  let s = '';
  for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s + (r + 1);
}

/** { r, c } from "B7". */
export function fromRef(ref) {
  const m = /^\$?([A-Z]+)\$?(\d+)$/.exec(String(ref || '').trim().toUpperCase());
  if (!m) return null;
  let c = 0;
  for (const ch of m[1]) c = c * 26 + (ch.charCodeAt(0) - 64);
  return { r: +m[2] - 1, c: c - 1 };
}

/** The rectangles a sheet's merges cover, as { r, c, rows, cols }. */
export function readMerges(list) {
  const out = [];
  for (const ref of list || []) {
    const [a, b] = String(ref).split(':');
    const from = fromRef(a), to = fromRef(b || a);
    if (!from || !to) continue;
    out.push({ r: from.r, c: from.c, rows: to.r - from.r + 1, cols: to.c - from.c + 1 });
  }
  return out;
}

/**
 * Cells laid out the way a table wants them: one array per row, indexed by column, plus the
 * merge that covers each cell so the ones inside a merged block can be skipped.
 */
export function layout(cells, { rows, cols, merges = [] }) {
  const grid = [];
  for (let r = 0; r < rows; r++) grid.push(new Array(cols).fill(null));
  for (const cell of cells) {
    if (cell[0] >= rows || cell[1] >= cols) continue;
    grid[cell[0]][cell[1]] = cell;
  }
  const covered = new Map();      // "r:c" -> the merge that owns it
  const spans = new Map();        // "r:c" -> { rows, cols } for the top-left of a merge
  for (const m of readMerges(merges)) {
    spans.set(m.r + ':' + m.c, { rows: m.rows, cols: m.cols });
    for (let r = m.r; r < m.r + m.rows; r++) {
      for (let c = m.c; c < m.c + m.cols; c++) {
        if (r === m.r && c === m.c) continue;
        covered.set(r + ':' + c, true);
      }
    }
  }
  return { grid, covered, spans };
}
