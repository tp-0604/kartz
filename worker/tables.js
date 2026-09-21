/**
 * The part of a sheet that is really a table.
 *
 * A grid is not a question anybody can ask. A table is: "who signed up and didn't show", "fame
 * by alliance", "which transfers are still waiting". So where a region of a sheet has a header
 * row with a body under it, its rows are written out here as one JSON object each, keyed by the
 * heading, and that is what the analyst and the filters read.
 *
 * Nothing is assumed about the columns. One of these tables has eighty-five of them and the
 * next has three; both are the same two tables in the database, because the columns live inside
 * a JSON value rather than in the schema. D1 caps a table at a hundred columns and this uses
 * nine, which is the whole point of doing it this way.
 *
 * Where a sheet is a drawing — a calendar, a squad map — there is no projection at all, because
 * there is nothing there to ask.
 */
import { HttpError, bad, chunk, newId, parseJson, str } from './util.js';

const ROW_MAX = 20000;
const COL_MAX = 200;

/** What a table looks like from outside: its columns, and how many rows it has. */
export async function readTables(env, sheetId) {
  const { results } = await env.DB.prepare(
    `SELECT id, name, header_row, first_row, last_row, first_col, last_col, rows, columns
       FROM tables WHERE sheet_id = ? ORDER BY first_row`).bind(str(sheetId)).all();
  return {
    tables: (results || []).map(t => ({
      id: t.id, name: t.name, headerRow: t.header_row, firstRow: t.first_row, lastRow: t.last_row,
      firstCol: t.first_col, lastCol: t.last_col, rows: t.rows, columns: parseJson(t.columns, []),
    })),
  };
}

/**
 * Replace a sheet's projection.
 *
 * The rows arrive already worked out — the reader that found the header row is the same one
 * that read the file, and it has the whole grid in hand. Twenty rows go in a statement, because
 * D1 allows a hundred bound parameters and a row costs five.
 */
export async function putTable(env, sheetId, body) {
  const sheet = await env.DB.prepare('SELECT id, file_id FROM sheets WHERE id = ?')
    .bind(str(sheetId)).first();
  if (!sheet) throw new HttpError(404, 'no such sheet.');

  const columns = Array.isArray(body && body.columns) ? body.columns.slice(0, COL_MAX) : [];
  const rows = Array.isArray(body && body.rows) ? body.rows.slice(0, ROW_MAX) : [];
  if (!columns.length) throw bad('a table needs columns.');

  const id = newId('tb');
  const stmts = [
    env.DB.prepare('DELETE FROM table_rows WHERE table_id IN (SELECT id FROM tables WHERE sheet_id = ?)')
      .bind(sheet.id),
    env.DB.prepare('DELETE FROM tables WHERE sheet_id = ?').bind(sheet.id),
    env.DB.prepare(
      `INSERT INTO tables (id, sheet_id, name, header_row, first_row, last_row, first_col, last_col,
                           rows, columns) VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .bind(id, sheet.id, str(body.name) || null,
            +body.headerRow || 0, +body.firstRow || 0, +body.lastRow || 0,
            +body.firstCol || 0, +body.lastCol || 0, rows.length, JSON.stringify(columns)),
  ];
  await env.DB.batch(stmts);

  // Twenty rows to a statement, forty statements to a batch: eight hundred rows a round trip.
  let n = 0;
  for (const group of chunk(rows, 20)) {
    const marks = group.map(() => '(?,?,?,?,?)').join(',');
    const binds = [];
    for (const row of group) {
      binds.push(newId('tr'), id, +row.idx || n++, +row.r || 0,
                 JSON.stringify(row.data === undefined ? {} : row.data));
    }
    await env.DB.prepare(`INSERT INTO table_rows (id, table_id, idx, r, data) VALUES ${marks}`)
      .bind(...binds).run();
  }
  return { table: id, rows: rows.length, columns: columns.length };
}

/** Everything a sheet's table holds, a page at a time. */
export async function readRows(env, tableId, { limit = 200, offset = 0 } = {}) {
  const table = await env.DB.prepare('SELECT * FROM tables WHERE id = ?').bind(str(tableId)).first();
  if (!table) throw new HttpError(404, 'no such table.');
  const { results } = await env.DB.prepare(
    'SELECT idx, r, data FROM table_rows WHERE table_id = ? ORDER BY idx LIMIT ? OFFSET ?')
    .bind(table.id, Math.min(1000, Math.max(1, +limit || 200)), Math.max(0, +offset || 0)).all();
  return {
    table: { id: table.id, name: table.name, rows: table.rows, columns: parseJson(table.columns, []) },
    rows: (results || []).map(r => ({ idx: r.idx, r: r.r, data: parseJson(r.data, {}) })),
  };
}

/* ------------------------------------------------------------------ what the analyst reads */

/** Every table in the database, with the file and tab it came from. */
export async function listTables(env, { search = '', limit = 60 } = {}) {
  const like = '%' + str(search).toLowerCase() + '%';
  const { results } = await env.DB.prepare(
    `SELECT t.id, t.name, t.rows, t.columns, s.name AS sheet, s.id AS sheet_id,
            f.name AS file, f.id AS file_id, fd.name AS folder
       FROM tables t
       JOIN sheets s ON s.id = t.sheet_id
       JOIN files f ON f.id = s.file_id
       LEFT JOIN folders fd ON fd.id = f.folder_id
      WHERE ?1 = '%%' OR lower(f.name) LIKE ?1 OR lower(s.name) LIKE ?1 OR lower(t.columns) LIKE ?1
      ORDER BY t.rows DESC
      LIMIT ?2`).bind(like, Math.min(200, Math.max(1, +limit || 60))).all();
  return {
    tables: (results || []).map(t => ({
      id: t.id, name: t.name || t.sheet, rows: t.rows,
      columns: parseJson(t.columns, []).map(c => c.header || c.key),
      sheet: t.sheet, sheetId: t.sheet_id, file: t.file, fileId: t.file_id, folder: t.folder,
    })),
  };
}

const OPS = new Set(['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'contains', 'starts', 'empty', 'notempty']);

/**
 * Rows of one table, filtered on the columns it happens to have.
 *
 * The filter runs in SQLite over the JSON, so a table with eighty-five columns is no harder
 * than one with three and neither needed a schema written for it in advance.
 */
export async function queryTable(env, tableId, { filters = [], sort = null, desc = false, limit = 50 } = {}) {
  const table = await env.DB.prepare('SELECT * FROM tables WHERE id = ?').bind(str(tableId)).first();
  if (!table) throw new HttpError(404, 'no such table.');

  const where = ['table_id = ?'];
  const binds = [table.id];
  for (const f of (Array.isArray(filters) ? filters : []).slice(0, 8)) {
    const field = str(f && f.field);
    if (!field) continue;
    const op = OPS.has(str(f.op)) ? str(f.op) : 'eq';
    const path = '$."' + field.replace(/"/g, '') + '"';
    const value = f.value;
    if (op === 'empty') { where.push(`(json_extract(data, ?) IS NULL OR json_extract(data, ?) = '')`); binds.push(path, path); continue; }
    if (op === 'notempty') { where.push(`(json_extract(data, ?) IS NOT NULL AND json_extract(data, ?) != '')`); binds.push(path, path); continue; }
    if (op === 'contains') { where.push(`lower(CAST(json_extract(data, ?) AS TEXT)) LIKE ?`); binds.push(path, '%' + str(value).toLowerCase() + '%'); continue; }
    if (op === 'starts') { where.push(`lower(CAST(json_extract(data, ?) AS TEXT)) LIKE ?`); binds.push(path, str(value).toLowerCase() + '%'); continue; }
    const sql = { eq: '=', ne: '!=', gt: '>', gte: '>=', lt: '<', lte: '<=' }[op];
    const asNumber = typeof value === 'number' || (str(value) !== '' && Number.isFinite(Number(value)));
    if (asNumber && op !== 'eq' && op !== 'ne') {
      where.push(`CAST(json_extract(data, ?) AS REAL) ${sql} ?`);
      binds.push(path, Number(value));
    } else {
      where.push(`CAST(json_extract(data, ?) AS TEXT) ${sql} ?`);
      binds.push(path, str(value));
    }
  }

  let order = 'idx';
  if (sort) {
    order = 'CAST(json_extract(data, ?) AS REAL) ' + (desc ? 'DESC' : 'ASC') + ', idx';
    binds.push('$."' + str(sort).replace(/"/g, '') + '"');
  }

  const n = Math.min(500, Math.max(1, +limit || 50));
  const { results } = await env.DB.prepare(
    `SELECT idx, r, data FROM table_rows WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ?`)
    .bind(...binds, n).all();
  const counted = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM table_rows WHERE ${where.join(' AND ')}`)
    .bind(...binds.slice(0, binds.length - (sort ? 1 : 0))).first();

  return {
    table: { id: table.id, name: table.name, columns: parseJson(table.columns, []) },
    matched: (counted && counted.n) || 0,
    rows: (results || []).map(r => parseJson(r.data, {})),
  };
}
