/**
 * A dataset is a table the workspace edits: the roster, or one board's scores.
 *
 * Two things are kept apart deliberately. The *record* is the typed columns — rank, player,
 * name in video, alliance, points — which every view queries and every aggregate is computed
 * from. The *extra* columns are the user's own, keyed by their heading, listed in the dataset's
 * meta row: a note, a CP figure, a column that came over from Google Sheets. They are stored,
 * exported and searched, and never interpreted.
 *
 * The grid is a view over this, not the shape of it. Nothing here knows how a cell is drawn,
 * and the column descriptors it hands out carry no library's idea of a column — which is what
 * makes the grid replaceable without touching the database.
 */
import { HttpError, bad, conflict, notFound, chunk, identity, logActivity,
         newId, now, nullable, parseJson, str, toInt } from './util.js';

const EXTRA = 'x:';                       // an extra column's key is its heading behind this
export const extraKey = h => EXTRA + h;
export const isExtra = k => k.startsWith(EXTRA);
export const extraName = k => k.slice(EXTRA.length);

// The five the record is made of. Width and type are hints for the grid; role is the contract.
export const RECORD_COLUMNS = [
  { key: 'place',    header: 'Rank',          type: 'int',  width: 72,  role: 'record' },
  { key: 'search',   header: 'Player',        type: 'text', width: 180, role: 'record' },
  { key: 'ingame',   header: 'Name in video', type: 'text', width: 190, role: 'record' },
  { key: 'alliance', header: 'Alliance',      type: 'text', width: 110, role: 'record' },
  { key: 'points',   header: 'Kartz Points',  type: 'int',  width: 130, role: 'record' },
];
export const ROSTER_RECORD = {
  search:   { key: 'search',   type: 'text', width: 190, role: 'record' },
  ingame:   { key: 'ingame',   type: 'text', width: 190, role: 'record' },
  alliance: { key: 'alliance', type: 'text', width: 120, role: 'record' },
};
export const DEFAULT_MAPPING = { search: 'Player', ingame: 'Name in video', alliance: 'Alliance' };

export const parseKey = key => {
  const k = str(key);
  if (k === 'roster') return { kind: 'roster', id: 'roster' };
  if (k.startsWith('board:')) {
    const id = k.slice(6);
    if (!id) throw bad('that dataset key names no board.');
    return { kind: 'board', id };
  }
  throw notFound('no such dataset.');
};
export const datasetKey = target => (target.kind === 'roster' ? 'roster' : 'board:' + target.id);

// ---------------------------------------------------------------------------------------
// Legacy: the workbook snapshot an older version of this app saved beside a board.
//
// Columns A–E were the record and anything to the right was the user's, kept only inside that
// snapshot — readable by one spreadsheet library and nothing else. Those columns are data, so
// the first time a board is opened they are read out of the snapshot and into the rows, and
// the board is marked so it is never read again. The snapshot itself is left where it is.
// ---------------------------------------------------------------------------------------
function univerGrid(snapshot) {
  const sheets = snapshot && snapshot.sheets;
  if (!sheets || typeof sheets !== 'object') return null;
  const order = Array.isArray(snapshot.sheetOrder) && snapshot.sheetOrder.length
    ? snapshot.sheetOrder : Object.keys(sheets);
  const ws = sheets[order[0]];
  if (!ws || !ws.cellData) return null;
  const grid = [];
  for (const [r, row] of Object.entries(ws.cellData)) {
    const ri = Number(r);
    if (!Number.isFinite(ri) || ri < 0 || ri > 5000) continue;
    const out = grid[ri] || (grid[ri] = []);
    for (const [c, cell] of Object.entries(row || {})) {
      const ci = Number(c);
      if (!Number.isFinite(ci) || ci < 0 || ci > 200) continue;
      // The cell object is kept, not just its value: the formatting is on it.
      out[ci] = cell && typeof cell === 'object' ? cell : { v: cell ?? '' };
    }
  }
  return grid.length ? grid : null;
}

// The old workbook stored a colour as a hex; this app stores a swatch name, so a recovered fill
// has to be snapped to one. Comparing the raw numbers does not work: a workbook's fills are pale
// tints, the swatches are mid-tones, and by straight distance #fff2cc — a plain pale yellow —
// comes out closer to grey than to yellow. What survives tinting is the hue, so that is what is
// compared, with anything nearly colourless taken as grey.
const SWATCH_HUE = { red: 2, orange: 30, yellow: 52, green: 130, teal: 172, blue: 212, purple: 272, pink: 330 };

function nearestSwatch(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  const l = (max + min) / 2;
  // White, near-white and near-black are "no fill": a workbook is mostly cells nobody coloured.
  if (l > 0.955 || l < 0.05) return null;
  const sat = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  if (sat < 0.12) return 'grey';
  let h = 0;
  if (max === r) h = 60 * (((g - b) / d) % 6);
  else if (max === g) h = 60 * ((b - r) / d + 2);
  else h = 60 * ((r - g) / d + 4);
  if (h < 0) h += 360;
  let best = 'grey', bestD = Infinity;
  for (const [name, hue] of Object.entries(SWATCH_HUE)) {
    const gap = Math.abs(((h - hue + 540) % 360) - 180);   // 0 is the same hue
    if (gap < bestD) { bestD = gap; best = name; }
  }
  return best;
}

// Univer keeps a style either inline on the cell or by id in a workbook-level table.
function univerStyle(snapshot, cell) {
  const raw = cell && (typeof cell.s === 'object' ? cell.s
    : (typeof cell.s === 'string' && snapshot.styles ? snapshot.styles[cell.s] : null));
  if (!raw || typeof raw !== 'object') return null;
  const out = {};
  const bg = raw.bg && (raw.bg.rgb || raw.bg.color);
  const fill = nearestSwatch(bg);
  if (fill) out.bg = fill;
  if (raw.bl) out.b = 1;
  if (raw.it) out.i = 1;
  if (raw.ul && (raw.ul.s === undefined || raw.ul.s)) out.u = 1;
  return Object.keys(out).length ? out : null;
}

async function recoverLegacyColumns(env, boardId) {
  const row = await env.DB.prepare('SELECT snapshot FROM board_sheets WHERE board_id = ?')
    .bind(boardId).first();
  const snapshot = row ? parseJson(row.snapshot, null) : null;
  const grid = snapshot ? univerGrid(snapshot) : null;
  const head = grid ? (grid[0] || []) : [];
  const columns = [];
  const at = [];
  for (let c = RECORD_COLUMNS.length; c < head.length; c++) {
    const h = str(head[c] && head[c].v);
    if (!h || columns.includes(h)) continue;
    columns.push(h);
    at.push({ col: c, header: h });
  }

  const stmts = [env.DB.prepare(
    `INSERT INTO board_meta (board_id, columns, layout, imported, updated_at) VALUES (?,?,'{}',1,?)
       ON CONFLICT(board_id) DO UPDATE SET columns = excluded.columns, imported = 1,
                                           updated_at = excluded.updated_at`)
    .bind(boardId, JSON.stringify(columns), now())];

  if (at.length && grid) {
    // Rows are joined on the rank in column A, which is the only thing in the snapshot that
    // also identifies a stored row.
    const byPlace = new Map();
    for (let r = 1; r < grid.length; r++) {
      const line = grid[r] || [];
      const place = toInt(line[0] && line[0].v, null);
      if (place === null) continue;
      const extra = {};
      for (const { col, header } of at) {
        const v = str(line[col] && line[col].v);
        if (v) extra[header] = v;
      }
      if (Object.keys(extra).length) byPlace.set(place, extra);
    }
    if (byPlace.size) {
      const up = env.DB.prepare('UPDATE scores SET extra = ? WHERE board_id = ? AND place = ? AND extra IS NULL');
      for (const [place, extra] of byPlace) stmts.push(up.bind(JSON.stringify(extra), boardId, place));
    }
  }

  // Whatever was filled, bolded or coloured in the old workbook comes across with it. The
  // columns are matched by position, which is what they were: A to E the record, then the rest.
  if (grid) {
    const keyAt = i => (i < RECORD_COLUMNS.length ? RECORD_COLUMNS[i].key : extraKey(str(head[i] && head[i].v)));
    const marks = new Map();
    for (let r = 1; r < grid.length; r++) {
      const line = grid[r] || [];
      const place = toInt(line[0] && line[0].v, null);
      if (place === null) continue;
      const bag = {};
      for (let c = 0; c < line.length; c++) {
        const st = univerStyle(snapshot, line[c]);
        const key = keyAt(c);
        if (st && key && !key.endsWith(':')) bag[key] = st;
      }
      if (Object.keys(bag).length) marks.set(place, bag);
    }
    if (marks.size) {
      const up = env.DB.prepare('UPDATE scores SET style = ? WHERE board_id = ? AND place = ? AND style IS NULL');
      for (const [place, bag] of marks) stmts.push(up.bind(JSON.stringify(bag), boardId, place));
    }
  }
  for (const part of chunk(stmts, 50)) await env.DB.batch(part);
  return columns;
}

async function boardMeta(env, boardId) {
  const meta = await env.DB.prepare('SELECT * FROM board_meta WHERE board_id = ?').bind(boardId).first();
  if (meta && meta.imported) return { columns: parseJson(meta.columns, []), layout: parseJson(meta.layout, {}) };
  const columns = await recoverLegacyColumns(env, boardId);
  return { columns, layout: meta ? parseJson(meta.layout, {}) : {} };
}

// ---------------------------------------------------------------------------------------
// Reading a dataset
// ---------------------------------------------------------------------------------------
const applyLayout = (columns, layout) => {
  const widths = (layout && layout.widths) || {};
  const hidden = new Set((layout && layout.hidden) || []);
  const order = Array.isArray(layout && layout.order) ? layout.order : null;
  const out = columns.map(c => ({ ...c, width: widths[c.key] || c.width, hidden: hidden.has(c.key) }));
  if (!order) return out;
  const at = k => { const i = order.indexOf(k); return i < 0 ? order.length + columns.findIndex(c => c.key === k) : i; };
  return out.sort((a, b) => at(a.key) - at(b.key));
};

// `__sort` is the stored order, sent along so a row inserted between two others can be given a
// place between them. It is not a column and nothing draws it.
const flatten = (row, columns) => {
  const extra = parseJson(row.extra, {});
  const style = parseJson(row.style, null);
  const out = { id: row.id, __sort: row.sort ?? 0, ...(style ? { __style: style } : {}) };
  for (const c of columns) {
    if (c.role === 'record') out[c.key] = row[c.key] ?? null;
    else out[c.key] = extra[extraName(c.key)] ?? null;
  }
  return out;
};

export function rosterColumns(meta) {
  const mapping = { ...DEFAULT_MAPPING, ...parseJson(meta && meta.mapping, {}) };
  let headings = parseJson(meta && meta.columns, []);
  if (!mapping.search) Object.assign(mapping, DEFAULT_MAPPING);
  if (!headings.length) headings = [mapping.search, mapping.ingame, mapping.alliance].filter(Boolean);
  const seen = new Set();
  const columns = [];
  for (const h of headings) {
    const header = str(h);
    if (!header || seen.has(header)) continue;
    seen.add(header);
    if (header === mapping.search) columns.push({ ...ROSTER_RECORD.search, header });
    else if (header === mapping.ingame) columns.push({ ...ROSTER_RECORD.ingame, header });
    else if (header === mapping.alliance) columns.push({ ...ROSTER_RECORD.alliance, header });
    else columns.push({ key: extraKey(header), header, type: 'text', width: 140, role: 'extra' });
  }
  if (!columns.some(c => c.key === 'search'))
    columns.unshift({ ...ROSTER_RECORD.search, header: mapping.search || DEFAULT_MAPPING.search });
  return { columns, mapping, headings: columns.map(c => c.header) };
}

export async function readDataset(env, key) {
  const target = parseKey(key);
  if (target.kind === 'roster') {
    const meta = await env.DB.prepare('SELECT * FROM roster_meta WHERE id = 1').first();
    const { columns, mapping } = rosterColumns(meta);
    const shown = applyLayout(columns, parseJson(meta && meta.layout, {}));
    const { results } = await env.DB.prepare(
      'SELECT id, search, ingame, alliance, extra, style, sort FROM roster ORDER BY sort, search COLLATE NOCASE').all();
    return {
      dataset: { key: 'roster', kind: 'roster', title: 'Roster', mapping,
                 rows: (results || []).length, savedAt: meta ? meta.saved_at : null },
      columns: shown,
      rows: (results || []).map(r => flatten(r, shown)),
      version: meta ? meta.version : 0,
    };
  }

  const board = await env.DB.prepare('SELECT * FROM boards WHERE id = ?').bind(target.id).first();
  if (!board) throw notFound('no such board.');
  const meta = await boardMeta(env, target.id);
  const columns = applyLayout([
    ...RECORD_COLUMNS,
    ...meta.columns.map(h => ({ key: extraKey(h), header: h, type: 'text', width: 140, role: 'extra' })),
  ], meta.layout);
  const { results } = await env.DB.prepare(
    `SELECT id, place, search, ingame, alliance, points, edited, extra, style, sort FROM scores
      WHERE board_id = ? ORDER BY sort, place`).bind(target.id).all();
  return {
    dataset: {
      key: datasetKey(target), kind: 'board', id: board.id, title: `${board.alliance} · ${board.date}`,
      date: board.date, alliance: board.alliance, label: board.label, event: board.event,
      rows: (results || []).length, savedAt: board.saved_at,
    },
    columns,
    rows: (results || []).map(r => ({ ...flatten(r, columns), edited: r.edited ? 1 : 0 })),
    version: board.version,
  };
}

/** Every dataset the workspace can open, for the navigator. */
export async function listDatasets(env) {
  const { results: boards } = await env.DB.prepare(
    `SELECT b.id, b.event, b.date, b.alliance, b.label, b.saved_at, b.version,
            COUNT(s.id) AS rows, MAX(s.points) AS best
       FROM boards b LEFT JOIN scores s ON s.board_id = b.id
      GROUP BY b.id ORDER BY b.date DESC, b.alliance ASC`).all();
  const rmeta = await env.DB.prepare('SELECT version, saved_at FROM roster_meta WHERE id = 1').first();
  const rcount = await env.DB.prepare('SELECT COUNT(*) n FROM roster').first();
  return {
    roster: { key: 'roster', kind: 'roster', title: 'Roster', rows: (rcount && rcount.n) || 0,
              version: rmeta ? rmeta.version : 0, savedAt: rmeta ? rmeta.saved_at : null },
    boards: (boards || []).map(b => ({
      key: 'board:' + b.id, kind: 'board', id: b.id, title: `${b.alliance} · ${b.date}`,
      event: b.event, date: b.date, alliance: b.alliance, label: b.label,
      rows: b.rows, best: b.best, version: b.version, savedAt: b.saved_at,
    })),
  };
}

// ---------------------------------------------------------------------------------------
// Writing: a batch of operations, applied together, against the version they were made on
//
// A cell edit is an op, a pasted block is a few hundred of them, and either way it is one
// request and one D1 batch. Nothing sends the dataset back to be rewritten, so a paste cannot
// silently undo what someone else saved a second earlier; the version says whether the copy
// the ops were made against is still the current one.
// ---------------------------------------------------------------------------------------
const OPS = new Set(['update', 'insert', 'delete', 'columns', 'layout']);

function coerce(column, value) {
  if (value === null || value === undefined) return { ok: true, value: null };
  if (column.type === 'int') {
    const s = str(value);
    if (!s) return { ok: true, value: null };
    const n = toInt(s, null);
    if (n === null) return { ok: false, reason: `“${s}” is not a number.` };
    return { ok: true, value: n };
  }
  return { ok: true, value: nullable(value) };
}

/** The ops, checked against the columns, split into what can be written and what cannot. */
function planRowOps(ops, columns, existing) {
  const byKey = new Map(columns.map(c => [c.key, c]));
  const writes = [];          // { kind, id, record:{}, extra:{}, sort }
  const rejected = [];
  const deletes = [];
  for (const raw of ops) {
    const op = str(raw && raw.op);
    if (!OPS.has(op)) { rejected.push({ reason: `unknown operation “${op}”.` }); continue; }
    if (op === 'columns' || op === 'layout') continue;
    const id = str(raw.id);
    if (!id) { rejected.push({ reason: 'an operation arrived with no row id.' }); continue; }
    if (op === 'delete') { deletes.push(id); continue; }
    if (op === 'update' && !existing.has(id)) {
      rejected.push({ id, reason: 'that row is no longer in the dataset.' });
      continue;
    }
    const record = {}, extra = {};
    let stop = false;
    for (const [k, v] of Object.entries(raw.values || {})) {
      const col = byKey.get(k);
      if (!col) { rejected.push({ id, field: k, reason: `there is no column “${k}”.` }); continue; }
      const out = coerce(col, v);
      if (!out.ok) { rejected.push({ id, field: k, reason: out.reason }); stop = true; continue; }
      if (col.role === 'record') record[col.key] = out.value;
      else extra[extraName(col.key)] = out.value;
    }
    if (stop && op === 'insert') continue;       // a new row that cannot be written at all
    // A style patch names columns, and a column named with null clears that cell's marking.
    // It is checked against the same column list as a value, so nothing can mark a column that
    // does not exist.
    const style = {};
    for (const [k, v] of Object.entries(raw.style || {})) {
      if (k !== ROW_STYLE && !byKey.has(k)) { rejected.push({ id, field: k, reason: `there is no column “${k}”.` }); continue; }
      style[k] = v === null ? null : cleanStyle(v);
    }
    writes.push({ kind: op, id, record, extra, style,
                  sort: Number.isFinite(Number(raw.sort)) ? Number(raw.sort) : null });
  }
  return { writes, deletes, rejected };
}

// The swatches a style may name, and the properties it may carry. Anything else is dropped —
// the browser chooses from a palette, it does not send colours, so a colour arriving here is
// either an old client or something that should not be trusted with the row.
const ROW_STYLE = '__row';
const FILLS = new Set(['grey', 'red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink']);
const INKS = new Set(['grey', 'red', 'orange', 'green', 'teal', 'blue', 'purple', 'pink']);
const ALIGN = new Set(['left', 'center', 'right']);

function cleanStyle(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const out = {};
  if (FILLS.has(raw.bg)) out.bg = raw.bg;
  if (INKS.has(raw.fg)) out.fg = raw.fg;
  if (raw.b) out.b = 1;
  if (raw.i) out.i = 1;
  if (raw.u) out.u = 1;
  if (ALIGN.has(raw.a)) out.a = raw.a;
  return Object.keys(out).length ? out : null;
}

const mergeStyleBag = (current, patch) => {
  const out = { ...current };
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete out[k];
    else out[k] = v;
  }
  return Object.keys(out).length ? JSON.stringify(out) : null;
};

const mergeExtra = (current, patch) => {
  const out = { ...current };
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === '') delete out[k];
    else out[k] = v;
  }
  return Object.keys(out).length ? JSON.stringify(out) : null;
};

/** Headings, as a column op leaves them: added, renamed, reordered or dropped. */
function planColumns(ops, headings) {
  let next = headings.slice();
  let touched = false;
  let layout = null;
  for (const raw of ops) {
    if (str(raw && raw.op) === 'layout') { layout = raw.layout && typeof raw.layout === 'object' ? raw.layout : {}; continue; }
    if (str(raw && raw.op) !== 'columns') continue;
    touched = true;
    if (Array.isArray(raw.columns)) {
      const seen = new Set();
      next = raw.columns.map(str).filter(h => h && !seen.has(h) && seen.add(h));
    }
    if (raw.rename && typeof raw.rename === 'object') {
      const { from, to } = raw.rename;
      const a = str(from), b = str(to);
      if (a && b && a !== b) next = next.map(h => (h === a ? b : h));
    }
  }
  return { headings: next, touched, layout };
}

export async function applyOps(env, key, body) {
  const target = parseKey(key);
  const ops = Array.isArray(body && body.ops) ? body.ops : null;
  if (!ops) throw bad('ops is required.');
  if (ops.length > 2000) throw bad(`too many operations in one batch (${ops.length}).`);

  return target.kind === 'roster'
    ? rosterOps(env, ops, body)
    : boardOps(env, target.id, ops, body);
}

async function boardOps(env, boardId, ops, body) {
  const board = await env.DB.prepare('SELECT * FROM boards WHERE id = ?').bind(boardId).first();
  if (!board) throw notFound('no such board.');
  if (body.version !== undefined && body.version !== null && Number(body.version) !== board.version)
    throw conflict('this board was saved by someone else since you opened it.', { version: board.version });

  const meta = await boardMeta(env, boardId);
  const plan = planColumns(ops, meta.columns);
  const headings = plan.touched ? plan.headings : meta.columns;
  const columns = [
    ...RECORD_COLUMNS,
    ...headings.map(h => ({ key: extraKey(h), header: h, type: 'text', width: 140, role: 'extra' })),
    // A rename or a drop still has to be able to clear the old column's values.
    ...meta.columns.filter(h => !headings.includes(h))
        .map(h => ({ key: extraKey(h), header: h, type: 'text', role: 'extra' })),
  ];

  const touchedIds = [...new Set(ops.filter(o => o && o.id).map(o => str(o.id)))];
  const existing = new Map();
  for (const part of chunk(touchedIds, 90)) {
    const { results } = await env.DB.prepare(
      `SELECT id, place, extra, style FROM scores WHERE board_id = ? AND id IN (${part.map(() => '?').join(',')})`)
      .bind(boardId, ...part).all();
    for (const r of results || []) existing.set(r.id, r);
  }

  const { writes, deletes, rejected } = planRowOps(ops, columns, existing);
  const stmts = [];
  const stamp = now();
  let inserted = 0, updated = 0;

  for (const w of writes) {
    const was = existing.get(w.id);
    const extra = mergeExtra(parseJson(was && was.extra, {}), w.extra);
    const style = mergeStyleBag(parseJson(was && was.style, {}), w.style);
    if (w.kind === 'insert' && !was) {
      const place = w.record.place ?? 0;
      stmts.push(env.DB.prepare(
        `INSERT INTO scores (id, board_id, place, search, ingame, alliance, points, edited, extra, style, sort)
         VALUES (?,?,?,?,?,?,?,1,?,?,?)`)
        .bind(w.id, boardId, place === null ? 0 : place, w.record.search ?? null,
              w.record.ingame ?? '', w.record.alliance ?? null,
              w.record.points === null || w.record.points === undefined ? 0 : w.record.points,
              extra, style, w.sort === null ? (place === null ? 0 : place) : w.sort));
      inserted++;
      continue;
    }
    const sets = [], binds = [];
    for (const [k, v] of Object.entries(w.record)) {
      // The three columns that cannot be empty take their zero rather than a null the column
      // would refuse; every other field keeps the difference between empty and unset.
      const value = k === 'ingame' ? (v ?? '') : k === 'points' || k === 'place' ? (v ?? 0) : v;
      sets.push(k + ' = ?'); binds.push(value);
    }
    if (Object.keys(w.extra).length) { sets.push('extra = ?'); binds.push(extra); }
    if (Object.keys(w.style).length) { sets.push('style = ?'); binds.push(style); }
    if (w.sort !== null) { sets.push('sort = ?'); binds.push(w.sort); }
    if (!sets.length) continue;
    // Marking a cell up is not correcting it, so it does not claim the row against a later
    // re-extraction. Only a changed value does that.
    if (Object.keys(w.record).length || Object.keys(w.extra).length) sets.push('edited = 1');
    stmts.push(env.DB.prepare(`UPDATE scores SET ${sets.join(', ')} WHERE id = ? AND board_id = ?`)
      .bind(...binds, w.id, boardId));
    updated++;
  }
  for (const part of chunk(deletes, 90)) {
    stmts.push(env.DB.prepare(
      `DELETE FROM scores WHERE board_id = ? AND id IN (${part.map(() => '?').join(',')})`)
      .bind(boardId, ...part));
  }
  if (plan.touched || plan.layout) {
    stmts.push(env.DB.prepare(
      `INSERT INTO board_meta (board_id, columns, layout, imported, updated_at) VALUES (?,?,?,1,?)
         ON CONFLICT(board_id) DO UPDATE SET columns = excluded.columns, layout = excluded.layout,
                                             imported = 1, updated_at = excluded.updated_at`)
      .bind(boardId, JSON.stringify(headings),
            JSON.stringify(plan.layout || meta.layout || {}), stamp));
  }
  stmts.push(env.DB.prepare('UPDATE boards SET version = version + 1, saved_at = ? WHERE id = ?')
    .bind(stamp, boardId));

  for (const part of chunk(stmts, 40)) await env.DB.batch(part);

  const summary = [inserted && `${inserted} row${inserted > 1 ? 's' : ''} added`,
                   updated && `${updated} row${updated > 1 ? 's' : ''} changed`,
                   deletes.length && `${deletes.length} row${deletes.length > 1 ? 's' : ''} deleted`,
                   plan.touched && 'columns changed'].filter(Boolean).join(', ');
  if (summary) await logActivity(env, 'edit', 'board:' + boardId, summary, { board: boardId });

  return { version: board.version + 1, applied: writes.length + deletes.length, rejected,
           inserted, updated, deleted: deletes.length, savedAt: stamp };
}

async function rosterOps(env, ops, body) {
  const meta = await env.DB.prepare('SELECT * FROM roster_meta WHERE id = 1').first();
  const version = meta ? meta.version : 0;
  if (body.version !== undefined && body.version !== null && Number(body.version) !== version)
    throw conflict('the roster was saved by someone else since you opened it.', { version });

  const { columns: current, mapping, headings: currentHeadings } = rosterColumns(meta);
  const plan = planColumns(ops, currentHeadings);
  const headings = plan.touched ? plan.headings : currentHeadings;
  // A renamed heading that was one of the three the app reads stays one of the three.
  const nextMapping = { ...mapping };
  if (plan.touched) {
    for (const raw of ops) {
      if (str(raw && raw.op) !== 'columns' || !raw.rename) continue;
      const a = str(raw.rename.from), b = str(raw.rename.to);
      for (const role of ['search', 'ingame', 'alliance'])
        if (nextMapping[role] === a) nextMapping[role] = b;
    }
    for (const raw of ops) {
      if (str(raw && raw.op) !== 'columns' || !raw.mapping) continue;
      for (const role of ['search', 'ingame', 'alliance'])
        if (raw.mapping[role] !== undefined) nextMapping[role] = str(raw.mapping[role]);
    }
    if (!headings.includes(nextMapping.search)) nextMapping.search = headings[0] || DEFAULT_MAPPING.search;
  }
  const columnsFor = hs => {
    const list = [];
    for (const h of hs) {
      if (h === nextMapping.search) list.push({ ...ROSTER_RECORD.search, header: h });
      else if (h === nextMapping.ingame) list.push({ ...ROSTER_RECORD.ingame, header: h });
      else if (h === nextMapping.alliance) list.push({ ...ROSTER_RECORD.alliance, header: h });
      else list.push({ key: extraKey(h), header: h, type: 'text', role: 'extra' });
    }
    return list;
  };
  const columns = [...columnsFor(headings),
                   ...current.filter(c => !headings.includes(c.header) && c.role === 'extra')];

  const touchedIds = [...new Set(ops.filter(o => o && o.id).map(o => str(o.id)))];
  const existing = new Map();
  for (const part of chunk(touchedIds, 95)) {
    const { results } = await env.DB.prepare(
      `SELECT id, search, extra, style FROM roster WHERE id IN (${part.map(() => '?').join(',')})`)
      .bind(...part).all();
    for (const r of results || []) existing.set(r.id, r);
  }

  const { writes, deletes, rejected } = planRowOps(ops, columns, existing);

  // A player name is the identity every score points at, so no two rows may share one. The
  // check is here rather than on the column, because a constraint can only refuse the whole
  // batch — this refuses the one row and says which other row it clashes with.
  const { results: all } = await env.DB.prepare('SELECT id, search FROM roster').all();
  const byName = new Map();
  for (const r of all || []) byName.set(str(r.search).toLowerCase(), r.id);
  for (const id of deletes) {
    const was = (all || []).find(r => r.id === id);
    if (was) byName.delete(str(was.search).toLowerCase());
  }
  const ok = [];
  for (const w of writes) {
    if (w.record.search === undefined) { ok.push(w); continue; }
    const name = str(w.record.search);
    if (!name) { rejected.push({ id: w.id, field: 'search', reason: 'a player needs a name.' }); continue; }
    const holder = byName.get(name.toLowerCase());
    if (holder && holder !== w.id) {
      rejected.push({ id: w.id, field: 'search', reason: `“${name}” is already another row's player name.` });
      continue;
    }
    const was = existing.get(w.id);
    if (was) byName.delete(str(was.search).toLowerCase());
    byName.set(name.toLowerCase(), w.id);
    ok.push(w);
  }

  const stamp = now();
  const stmts = [];
  let inserted = 0, updated = 0;
  for (const w of ok) {
    const was = existing.get(w.id);
    const extra = mergeExtra(parseJson(was && was.extra, {}), w.extra);
    const style = mergeStyleBag(parseJson(was && was.style, {}), w.style);
    if (w.kind === 'insert' && !was) {
      stmts.push(env.DB.prepare(
        'INSERT INTO roster (id, search, ingame, alliance, extra, style, sort, updated_at) VALUES (?,?,?,?,?,?,?,?)')
        .bind(w.id, w.record.search ?? '', w.record.ingame || w.record.search || '',
              w.record.alliance ?? null, extra, style, w.sort === null ? 1e9 : w.sort, stamp));
      inserted++;
      continue;
    }
    const sets = [], binds = [];
    for (const [k, v] of Object.entries(w.record)) {
      const value = k === 'search' || k === 'ingame' ? (v ?? '') : v;
      sets.push(k + ' = ?'); binds.push(value);
    }
    if (Object.keys(w.extra).length) { sets.push('extra = ?'); binds.push(extra); }
    if (Object.keys(w.style).length) { sets.push('style = ?'); binds.push(style); }
    if (w.sort !== null) { sets.push('sort = ?'); binds.push(w.sort); }
    if (!sets.length) continue;
    sets.push('updated_at = ?'); binds.push(stamp);
    stmts.push(env.DB.prepare(`UPDATE roster SET ${sets.join(', ')} WHERE id = ?`).bind(...binds, w.id));
    updated++;
  }
  for (const part of chunk(deletes, 95))
    stmts.push(env.DB.prepare(`DELETE FROM roster WHERE id IN (${part.map(() => '?').join(',')})`).bind(...part));

  stmts.push(env.DB.prepare(
    `UPDATE roster_meta SET columns = ?, mapping = ?, labels = ?, layout = ?,
            version = version + 1, saved_at = ? WHERE id = 1`)
    .bind(JSON.stringify(headings), JSON.stringify(nextMapping),
          JSON.stringify([nextMapping.search, nextMapping.ingame || '', nextMapping.alliance || '']),
          JSON.stringify(plan.layout || parseJson(meta && meta.layout, {})), stamp));

  for (const part of chunk(stmts, 40)) await env.DB.batch(part);

  const summary = [inserted && `${inserted} player${inserted > 1 ? 's' : ''} added`,
                   updated && `${updated} player${updated > 1 ? 's' : ''} changed`,
                   deletes.length && `${deletes.length} player${deletes.length > 1 ? 's' : ''} removed`,
                   plan.touched && 'columns changed'].filter(Boolean).join(', ');
  if (summary) await logActivity(env, 'edit', 'roster', summary);

  return { version: version + 1, applied: ok.length + deletes.length, rejected,
           inserted, updated, deleted: deletes.length, savedAt: stamp,
           mapping: nextMapping, columns: headings };
}

// ---------------------------------------------------------------------------------------
// Replacing a dataset wholesale — an import, or a list pasted in from somewhere else.
// ---------------------------------------------------------------------------------------
export async function replaceRoster(env, body) {
  const meta = await env.DB.prepare('SELECT version FROM roster_meta WHERE id = 1').first();
  const version = meta ? meta.version : 0;
  if (body.version !== undefined && body.version !== null && Number(body.version) !== version)
    throw conflict('the roster was saved by someone else since you opened it — reload it and re-apply your edits.',
                   { version });
  const rows = Array.isArray(body.rows) ? body.rows : null;
  if (!rows) throw bad('rows is required.');
  if (rows.length > 3000) throw bad(`too many rows (${rows.length}).`);
  if (!rows.length && !body.allowEmpty)
    throw bad('that would delete every player. If you meant it, clear the rows and save again.');
  const mapping = { ...DEFAULT_MAPPING, ...(body.mapping && typeof body.mapping === 'object' ? body.mapping : {}) };
  if (!mapping.search) throw bad('the save did not say which column holds the player name.');

  const stamp = now();
  const ins = env.DB.prepare(
    'INSERT INTO roster (id, search, ingame, alliance, extra, sort, updated_at) VALUES (?,?,?,?,?,?,?)');
  const stmts = [env.DB.prepare('DELETE FROM roster')];
  const seen = new Set(), skipped = [];
  let n = 0;
  for (const r of rows) {
    const search = str(r.search);
    if (!search) continue;
    const k = search.toLowerCase();
    if (seen.has(k)) { skipped.push(search); continue; }
    seen.add(k);
    const extra = r.extra && typeof r.extra === 'object'
      ? Object.fromEntries(Object.entries(r.extra).filter(([, v]) => str(v))) : {};
    stmts.push(ins.bind(str(r.id) || newId('p'), search, str(r.ingame) || search,
                        nullable(r.alliance), Object.keys(extra).length ? JSON.stringify(extra) : null,
                        n, stamp));
    n++;
  }
  stmts.push(env.DB.prepare(
    `UPDATE roster_meta SET columns = ?, labels = ?, mapping = ?, layout = ?, snapshot = NULL,
            version = version + 1, saved_at = ? WHERE id = 1`)
    .bind(JSON.stringify(Array.isArray(body.columns) ? body.columns.map(str).filter(Boolean) : []),
          JSON.stringify([mapping.search, mapping.ingame || '', mapping.alliance || '']),
          JSON.stringify(mapping),
          JSON.stringify(body.layout && typeof body.layout === 'object' ? body.layout : {}), stamp));

  for (const part of chunk(stmts, 40)) await env.DB.batch(part);
  await logActivity(env, 'import', 'roster', `roster replaced — ${n} players`, { skipped: skipped.length });
  return { saved: n, skipped, version: version + 1, savedAt: stamp };
}

export { HttpError };
