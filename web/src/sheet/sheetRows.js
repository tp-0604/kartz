/**
 * Between a dataset and the spreadsheet.
 *
 * The spreadsheet gets the rows as a plain block: a heading row, then one line per row, with the
 * row's id in a hidden first column. The id is what lets an edit made there find its row again
 * here — after a sort, a moved row, a deleted one — without trusting position at all.
 *
 * Coming back, the block is compared with the rows it was built from, and what differs becomes
 * the same operations a grid edit sends: an update for a changed row, an insert for a line with no
 * id, a delete for an id that is no longer there, and a new column for a heading nobody had. A
 * column that has gone from the spreadsheet is left alone in the data: removing a column is done
 * on purpose, from Columns, not by accident in a spreadsheet.
 */
import { coerce, extraKey } from '../data/model.js';

export const ID_HEADER = 'row id';

const text = v => (v === null || v === undefined ? '' : String(v).trim());
const cellValue = v => (v && typeof v === 'object' && 'v' in v ? v.v : v);

// A spreadsheet reads "007" or "141" back as a number. That is the engine's idea of the cell,
// not an edit, so it is not sent as one.
function same(column, raw, was) {
  if (text(coerce(column, raw)) === text(was)) return true;
  return typeof raw === 'number' && typeof was === 'string' && was.trim() !== ''
    && Number(was.replace(/[,\s]/g, '')) === raw;
}

/** Rows → the block the spreadsheet opens with. */
export function toBlock(columns, rows) {
  return [
    [ID_HEADER, ...columns.map(c => c.header)],
    ...rows.map(r => [r.id, ...columns.map(c => r[c.key] ?? '')]),
  ];
}

/**
 * The block as it is now, against the rows it was opened from.
 *
 * @returns {{ ops: object[], inserted: {line:number,id:string}[],
 *             counts: {updated:number, inserted:number, deleted:number, columns:number} }}
 */
export function diffBlock(block, columns, rows, { kind, newId }) {
  const lines = Array.isArray(block) ? block : [];
  const head = (lines[0] || []).map(v => text(cellValue(v)));
  // Without the id column every row would look new and every stored row deleted. Refuse instead.
  if (head[0] !== ID_HEADER)
    throw new Error('the hidden row id column (column A) has been moved or removed, so the rows '
      + 'cannot be matched. Close without saving and open the spreadsheet again.');

  const byHeader = new Map(columns.map(c => [c.header, c]));
  const newColumns = [];
  const at = [];                                   // [position in the block, column]
  for (let i = 1; i < head.length; i++) {
    const h = head[i];
    if (!h || h === ID_HEADER) continue;
    let col = byHeader.get(h);
    if (!col) {
      if (newColumns.includes(h)) continue;
      newColumns.push(h);
      col = { key: extraKey(h), header: h, type: 'text', role: 'extra' };
    }
    if (at.some(([, c]) => c.key === col.key)) continue;     // a heading used twice counts once
    at.push([i, col]);
  }

  const byId = new Map(rows.map(r => [r.id, r]));
  const seen = new Set();
  const updates = [], inserts = [], inserted = [];
  let tail = rows.reduce((m, r) => Math.max(m, Number(r.__sort) || 0), 0);

  for (let line = 1; line < lines.length; line++) {
    const cells = lines[line] || [];
    const id = text(cellValue(cells[0]));
    const row = id && !seen.has(id) ? byId.get(id) : null;
    if (row) {
      seen.add(id);
      const values = {};
      for (const [i, col] of at) {
        const raw = cellValue(cells[i]);
        if (!same(col, raw, row[col.key])) values[col.key] = coerce(col, raw);
      }
      if (Object.keys(values).length) updates.push({ op: 'update', id, values });
      continue;
    }
    // A line with no id, or a copy of a row that already appeared above, is a new row — if it
    // holds anything at all.
    const values = {};
    for (const [i, col] of at) {
      const v = coerce(col, cellValue(cells[i]));
      if (v !== null) values[col.key] = v;
    }
    if (!Object.keys(values).length) continue;
    const newRow = newId();
    inserts.push({ op: 'insert', id: newRow, sort: ++tail, values });
    inserted.push({ line, id: newRow });
  }

  const deletes = rows.filter(r => !seen.has(r.id)).map(r => ({ op: 'delete', id: r.id }));
  const ops = [];
  if (newColumns.length) {
    // What the columns op carries is the dataset's own headings: a board's extras, or every
    // heading the roster has.
    const own = kind === 'roster' ? columns.map(c => c.header)
      : columns.filter(c => c.role === 'extra').map(c => c.header);
    ops.push({ op: 'columns', columns: [...own, ...newColumns] });
  }
  ops.push(...inserts, ...updates, ...deletes);
  return {
    ops, inserted,
    counts: { updated: updates.length, inserted: inserts.length, deleted: deletes.length, columns: newColumns.length },
  };
}
