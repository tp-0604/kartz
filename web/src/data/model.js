/**
 * The application's data model, kept deliberately apart from whatever draws it.
 *
 * A dataset is a list of columns and a list of rows. Five of a board's columns are the record —
 * rank, player, name in video, alliance, points — and the rest are the user's own, carried under
 * an `x:` key and stored by their heading. The grid never sees the difference; the database
 * never sees the grid.
 */
export const EXTRA = 'x:';
export const isExtra = key => key.startsWith(EXTRA);
export const extraName = key => key.slice(EXTRA.length);
export const extraKey = header => EXTRA + header;

export const boardKey = id => 'board:' + id;
export const isBoardKey = key => key.startsWith('board:');
export const boardIdOf = key => (isBoardKey(key) ? key.slice(6) : null);

/** A value as the column means it, for the local copy of a row. */
export function coerce(column, value) {
  if (value === null || value === undefined) return null;
  if (column.type === 'int') {
    const s = String(value).replace(/[,\s]/g, '');
    if (!s) return null;
    const n = Number(s);
    return Number.isFinite(n) ? Math.round(n) : String(value).trim();   // kept so the cell can say it is wrong
  }
  const s = String(value).trim();
  return s === '' ? null : s;
}

export const isBadValue = (column, value) =>
  column.type === 'int' && value !== null && value !== undefined && typeof value !== 'number';

export const display = (column, value) => {
  if (value === null || value === undefined) return '';
  return column.type === 'int' && typeof value === 'number' ? value.toLocaleString() : String(value);
};

/** An empty row, with whatever the caller already knows about it. */
export function blankRow(columns, id, seed = {}) {
  const row = { id };
  for (const c of columns) row[c.key] = seed[c.key] ?? null;
  return row;
}

/**
 * What is wrong with the rows, in the user's terms rather than the database's.
 *
 * These are warnings, not refusals. A half-typed row is a normal state to be in for a few
 * seconds, and a save that refused it would be worse than one that says what it noticed.
 */
export function problems(kind, rows) {
  const out = [];
  if (kind === 'roster') {
    const seen = new Map();
    rows.forEach((r, i) => {
      const name = String(r.search ?? '').trim();
      if (!name) { out.push({ row: i, key: 'search', text: `row ${i + 1} has no player name` }); return; }
      const k = name.toLowerCase();
      if (seen.has(k)) out.push({ row: i, key: 'search',
        text: `“${name}” is on row ${seen.get(k) + 1} and again on row ${i + 1}` });
      else seen.set(k, i);
    });
    return out;
  }
  const seen = new Map();
  rows.forEach((r, i) => {
    const place = r.place;
    if (typeof place !== 'number' || place <= 0) out.push({ row: i, key: 'place', text: `row ${i + 1} has no rank` });
    else if (seen.has(place)) out.push({ row: i, key: 'place',
      text: `rank ${place} is on row ${seen.get(place) + 1} and again on row ${i + 1}` });
    else seen.set(place, i);
    if (!String(r.ingame ?? '').trim()) out.push({ row: i, key: 'ingame', text: `row ${i + 1} has no name` });
    if (typeof r.points !== 'number') out.push({ row: i, key: 'points', text: `row ${i + 1} has no points` });
  });
  return out;
}

/** Between two neighbours, so an inserted row stays where it was put without renumbering. */
export function sortBetween(before, after) {
  const a = before === undefined || before === null ? null : Number(before);
  const b = after === undefined || after === null ? null : Number(after);
  if (a === null && b === null) return 0;
  if (a === null) return b - 1;
  if (b === null) return a + 1;
  return a + (b - a) / 2;
}

// ---- searching, sorting and filtering, all over the rows the browser already has -----------
export const FILTER_OPS = [
  { op: 'contains', label: 'contains', types: ['text'] },
  { op: 'eq',       label: 'is',       types: ['text', 'int'] },
  { op: 'ne',       label: 'is not',   types: ['text', 'int'] },
  { op: 'gt',       label: 'more than', types: ['int'] },
  { op: 'lt',       label: 'less than', types: ['int'] },
  { op: 'gte',      label: 'at least',  types: ['int'] },
  { op: 'lte',      label: 'at most',   types: ['int'] },
  { op: 'empty',    label: 'is empty',  types: ['text', 'int'] },
  { op: 'filled',   label: 'is not empty', types: ['text', 'int'] },
];

const asText = v => (v === null || v === undefined ? '' : String(v)).toLowerCase();

export function matchesFilter(row, filter, column) {
  const v = row[filter.key];
  const want = filter.value;
  switch (filter.op) {
    case 'empty':  return v === null || v === undefined || v === '';
    case 'filled': return !(v === null || v === undefined || v === '');
    case 'contains': return asText(v).includes(asText(want));
    case 'eq': return column && column.type === 'int' ? Number(v) === Number(want) : asText(v) === asText(want);
    case 'ne': return column && column.type === 'int' ? Number(v) !== Number(want) : asText(v) !== asText(want);
    case 'gt': return Number(v) > Number(want);
    case 'lt': return Number(v) < Number(want);
    case 'gte': return Number(v) >= Number(want);
    case 'lte': return Number(v) <= Number(want);
    default: return true;
  }
}

/** The rows a view actually shows: filtered, searched, then sorted. */
export function shape(rows, columns, { filters = [], query = '', sort = null } = {}) {
  const byKey = new Map(columns.map(c => [c.key, c]));
  let out = rows;
  for (const f of filters) {
    if (!f.key || !f.op) continue;
    const col = byKey.get(f.key);
    out = out.filter(r => matchesFilter(r, f, col));
  }
  const q = query.trim().toLowerCase();
  if (q) out = out.filter(r => columns.some(c => asText(r[c.key]).includes(q)));
  if (sort && sort.key && byKey.has(sort.key)) {
    const col = byKey.get(sort.key);
    const dir = sort.dir === 'asc' ? 1 : -1;
    out = out.slice().sort((a, b) => {
      const x = a[sort.key], y = b[sort.key];
      const xe = x === null || x === undefined || x === '', ye = y === null || y === undefined || y === '';
      if (xe && ye) return 0;
      if (xe) return 1;                        // empties settle at the bottom whichever way it sorts
      if (ye) return -1;
      const n = col.type === 'int' && typeof x === 'number' && typeof y === 'number'
        ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true, sensitivity: 'base' });
      return n * dir;
    });
  }
  return out;
}
