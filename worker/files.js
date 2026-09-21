/**
 * Folders, files, sheets, and the grid.
 *
 * A file is a workbook and a sheet is one of its tabs. A tab's grid is kept as slabs — five
 * hundred sheet rows each, gzipped by whoever is writing — so opening a tab pulls the bands
 * being looked at rather than the whole thing, and so a row in D1 stays far under the two
 * megabytes it allows.
 *
 * Nothing here knows what the data is about. That is the point: the files this holds range
 * from a form's responses to a calendar drawn in merged cells, and the only thing they have in
 * common is that they are grids. What can be queried comes from the projection in tables.js,
 * which runs over the regions that really are tables.
 *
 * Who may do what is decided in auth.js and applied at the routes, the same as boards: anyone
 * signed in can make a file, and only whoever made it — or an admin — can write over it.
 */
import { HttpError, bad, chunk, logActivity, newId, now, nullable, parseJson, str } from './util.js';

export const BAND = 500;                       // sheet rows per slab
const SLAB_MAX = 1_000_000;                    // bytes, gzipped; D1's own ceiling is 2 MB
const NAME_MAX = 120;
const SHAPES = new Set(['table', 'layout', 'mixed', 'empty']);

const nameOf = (raw, what = 'a name') => {
  const name = str(raw).replace(/\s+/g, ' ');
  if (!name) throw bad(`${what} is required.`);
  if (name.length > NAME_MAX) throw bad(`${what} is too long.`);
  return name;
};

/* --------------------------------------------------------------------------------- the tree */

/** Every folder and file, in one answer. The tree is small; the grids are not, and stay put. */
export async function listTree(env) {
  const folders = await env.DB.prepare(
    'SELECT id, parent_id, name, sort, created_at FROM folders ORDER BY sort, name').all();
  const files = await env.DB.prepare(
    `SELECT f.id, f.folder_id, f.name, f.source, f.sheets, f.cells, f.updated_at, f.ready,
            f.created_by, u.name AS owner
       FROM files f LEFT JOIN users u ON u.id = f.created_by
      WHERE f.ready = 1
      ORDER BY f.name`).all();
  return { folders: folders.results || [], files: files.results || [] };
}

export async function makeFolder(env, body) {
  const name = nameOf(body && body.name, 'a folder name');
  const parent = nullable(body && body.parentId);
  if (parent) {
    const up = await env.DB.prepare('SELECT id FROM folders WHERE id = ?').bind(parent).first();
    if (!up) throw bad('no such parent folder.');
  }
  const id = newId('fd');
  await env.DB.prepare(
    'INSERT INTO folders (id, parent_id, name, sort, created_at, created_by) VALUES (?,?,?,?,?,?)')
    .bind(id, parent, name, Number(body && body.sort) || 0, now(), env.user ? env.user.id : null).run();
  return { folder: { id, parent_id: parent, name } };
}

export async function renameFolder(env, id, body) {
  const name = nameOf(body && body.name, 'a folder name');
  const r = await env.DB.prepare('UPDATE folders SET name = ? WHERE id = ?').bind(name, str(id)).run();
  if (!r.meta || !r.meta.changes) throw new HttpError(404, 'no such folder.');
  return { folder: { id: str(id), name } };
}

/** A folder goes only when it is empty, so nothing is deleted that was not asked for. */
export async function deleteFolder(env, id) {
  const has = await env.DB.prepare(
    `SELECT (SELECT COUNT(*) FROM files WHERE folder_id = ?1) AS files,
            (SELECT COUNT(*) FROM folders WHERE parent_id = ?1) AS folders`).bind(str(id)).first();
  if (has && (has.files || has.folders))
    throw bad(`that folder still holds ${has.files} file${has.files === 1 ? '' : 's'} and `
            + `${has.folders} folder${has.folders === 1 ? '' : 's'}. Move or delete them first.`);
  const r = await env.DB.prepare('DELETE FROM folders WHERE id = ?').bind(str(id)).run();
  if (!r.meta || !r.meta.changes) throw new HttpError(404, 'no such folder.');
  return { deleted: str(id) };
}

/* -------------------------------------------------------------------------------- one file */

export const readFileRow = (env, id) => env.DB.prepare(
  'SELECT * FROM files WHERE id = ?').bind(str(id)).first();

/** A file with its tabs and its styles, but not one cell: enough to draw the tab strip. */
export async function readFile(env, id) {
  const file = await readFileRow(env, id);
  if (!file) throw new HttpError(404, 'no such file.');
  const owner = file.created_by
    ? await env.DB.prepare('SELECT name FROM users WHERE id = ?').bind(file.created_by).first()
    : null;
  const sheets = await env.DB.prepare(
    `SELECT id, name, idx, shape, rows, cols, cells, hidden, frozen, tab_color, defaults, version
       FROM sheets WHERE file_id = ? ORDER BY idx`).bind(file.id).all();
  const styles = await env.DB.prepare(
    'SELECT idx, json FROM styles WHERE file_id = ? ORDER BY idx').bind(file.id).all();

  const list = (sheets.results || []).map(s => ({
    id: s.id, name: s.name, idx: s.idx, shape: s.shape, rows: s.rows, cols: s.cols,
    cells: s.cells, hidden: !!s.hidden, version: s.version,
    frozen: parseJson(s.frozen, null), tabColor: s.tab_color, defaults: parseJson(s.defaults, {}),
    bands: Math.max(1, Math.ceil((s.rows || 1) / BAND)),
  }));
  const pool = [];
  for (const row of styles.results || []) pool[row.idx] = parseJson(row.json, {});
  for (let i = 0; i < pool.length; i++) if (!pool[i]) pool[i] = {};

  return {
    file: {
      id: file.id, name: file.name, folderId: file.folder_id, source: file.source,
      sourceName: file.source_name, sheets: file.sheets, cells: file.cells,
      version: file.version, updatedAt: file.updated_at, createdAt: file.created_at,
      ownerId: file.created_by, owner: owner ? owner.name : null,
      report: parseJson(file.report, null),
    },
    sheets: list,
    styles: pool,
  };
}

export async function makeFile(env, body) {
  const name = nameOf(body && body.name, 'a file name');
  const folder = nullable(body && body.folderId);
  if (folder) {
    const f = await env.DB.prepare('SELECT id FROM folders WHERE id = ?').bind(folder).first();
    if (!f) throw bad('no such folder.');
  }
  const source = str(body && body.source) || 'new';
  const id = newId('fl');
  const at = now();
  await env.DB.prepare(
    `INSERT INTO files (id, folder_id, name, source, source_name, ready, created_at, updated_at, created_by)
     VALUES (?,?,?,?,?,?,?,?,?)`)
    .bind(id, folder, name, source, nullable(body && body.sourceName),
          source === 'new' ? 1 : 0, at, at, env.user ? env.user.id : null).run();
  await logActivity(env, 'file', 'file:' + id, `made the file ${name}`);
  return { file: { id, name, folderId: folder, source, ready: source === 'new' } };
}

export async function patchFile(env, id, body) {
  const file = await readFileRow(env, id);
  if (!file) throw new HttpError(404, 'no such file.');
  const sets = [], binds = [];
  if (body.name !== undefined) { sets.push('name = ?'); binds.push(nameOf(body.name, 'a file name')); }
  if (body.folderId !== undefined) {
    const folder = nullable(body.folderId);
    if (folder && !await env.DB.prepare('SELECT id FROM folders WHERE id = ?').bind(folder).first())
      throw bad('no such folder.');
    sets.push('folder_id = ?'); binds.push(folder);
  }
  if (!sets.length) return { file: { id: file.id } };
  sets.push('updated_at = ?'); binds.push(now());
  await env.DB.prepare(`UPDATE files SET ${sets.join(', ')} WHERE id = ?`).bind(...binds, file.id).run();
  await logActivity(env, 'file', 'file:' + file.id,
    body.name !== undefined ? `renamed ${file.name} to ${str(body.name)}` : `moved ${file.name}`);
  return { file: { id: file.id } };
}

/** A file and everything under it, including its pictures' rows. The R2 objects are shared, so
 *  they are left alone; nothing else points at a slab or a style but this file. */
export async function deleteFile(env, id) {
  const file = await readFileRow(env, id);
  if (!file) throw new HttpError(404, 'no such file.');
  const sheets = await env.DB.prepare('SELECT id FROM sheets WHERE file_id = ?').bind(file.id).all();
  const ids = (sheets.results || []).map(s => s.id);

  const stmts = [];
  for (const group of chunk(ids, 50)) {
    const marks = group.map(() => '?').join(',');
    stmts.push(env.DB.prepare(`DELETE FROM slabs WHERE sheet_id IN (${marks})`).bind(...group));
    stmts.push(env.DB.prepare(`DELETE FROM sheet_meta WHERE sheet_id IN (${marks})`).bind(...group));
    stmts.push(env.DB.prepare(
      `DELETE FROM table_rows WHERE table_id IN (SELECT id FROM tables WHERE sheet_id IN (${marks}))`)
      .bind(...group));
    stmts.push(env.DB.prepare(`DELETE FROM tables WHERE sheet_id IN (${marks})`).bind(...group));
  }
  stmts.push(env.DB.prepare('DELETE FROM sheets WHERE file_id = ?').bind(file.id));
  stmts.push(env.DB.prepare('DELETE FROM styles WHERE file_id = ?').bind(file.id));
  stmts.push(env.DB.prepare('DELETE FROM files WHERE id = ?').bind(file.id));
  if (stmts.length) await env.DB.batch(stmts);

  await logActivity(env, 'delete-file', 'file:' + file.id,
    `deleted the file ${file.name} — ${ids.length} sheet${ids.length === 1 ? '' : 's'}`);
  return { deleted: file.id, sheets: ids.length };
}

/* ------------------------------------------------------------------------------- one sheet */

export const readSheetRow = (env, id) => env.DB.prepare(
  'SELECT * FROM sheets WHERE id = ?').bind(str(id)).first();

export async function addSheet(env, fileId, body) {
  const file = await readFileRow(env, fileId);
  if (!file) throw new HttpError(404, 'no such file.');
  const name = nameOf(body && body.name, 'a sheet name');
  const shape = SHAPES.has(str(body && body.shape)) ? str(body.shape) : 'table';
  const idx = Number.isFinite(+(body && body.idx)) ? +body.idx
    : ((await env.DB.prepare('SELECT MAX(idx) AS m FROM sheets WHERE file_id = ?')
        .bind(file.id).first()) || {}).m + 1 || 0;
  const id = newId('sh');
  await env.DB.prepare(
    `INSERT INTO sheets (id, file_id, name, idx, shape, rows, cols, cells, hidden, frozen, tab_color, defaults)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(id, file.id, name, idx, shape,
          Math.max(0, +(body && body.rows) || 0), Math.max(0, +(body && body.cols) || 0), 0,
          body && body.hidden ? 1 : 0,
          body && body.frozen ? JSON.stringify(body.frozen) : null,
          nullable(body && body.tabColor),
          body && body.defaults ? JSON.stringify(body.defaults) : null).run();
  await env.DB.prepare('UPDATE files SET sheets = sheets + 1, updated_at = ? WHERE id = ?')
    .bind(now(), file.id).run();
  return { sheet: { id, fileId: file.id, name, idx, shape } };
}

export async function patchSheet(env, id, body) {
  const sheet = await readSheetRow(env, id);
  if (!sheet) throw new HttpError(404, 'no such sheet.');
  const sets = [], binds = [];
  if (body.name !== undefined) { sets.push('name = ?'); binds.push(nameOf(body.name, 'a sheet name')); }
  if (body.idx !== undefined) { sets.push('idx = ?'); binds.push(Math.max(0, +body.idx || 0)); }
  if (body.shape !== undefined) {
    if (!SHAPES.has(str(body.shape))) throw bad('a shape is table, layout, mixed or empty.');
    sets.push('shape = ?'); binds.push(str(body.shape));
  }
  if (body.hidden !== undefined) { sets.push('hidden = ?'); binds.push(body.hidden ? 1 : 0); }
  if (body.tabColor !== undefined) { sets.push('tab_color = ?'); binds.push(nullable(body.tabColor)); }
  if (body.frozen !== undefined) {
    sets.push('frozen = ?'); binds.push(body.frozen ? JSON.stringify(body.frozen) : null);
  }
  if (!sets.length) return { sheet: { id: sheet.id } };
  await env.DB.prepare(`UPDATE sheets SET ${sets.join(', ')} WHERE id = ?`).bind(...binds, sheet.id).run();
  return { sheet: { id: sheet.id } };
}

export async function deleteSheet(env, id) {
  const sheet = await readSheetRow(env, id);
  if (!sheet) throw new HttpError(404, 'no such sheet.');
  await env.DB.batch([
    env.DB.prepare('DELETE FROM slabs WHERE sheet_id = ?').bind(sheet.id),
    env.DB.prepare('DELETE FROM sheet_meta WHERE sheet_id = ?').bind(sheet.id),
    env.DB.prepare('DELETE FROM table_rows WHERE table_id IN (SELECT id FROM tables WHERE sheet_id = ?)')
      .bind(sheet.id),
    env.DB.prepare('DELETE FROM tables WHERE sheet_id = ?').bind(sheet.id),
    env.DB.prepare('DELETE FROM sheets WHERE id = ?').bind(sheet.id),
    env.DB.prepare('UPDATE files SET sheets = MAX(0, sheets - 1), updated_at = ? WHERE id = ?')
      .bind(now(), sheet.file_id),
  ]);
  return { deleted: sheet.id };
}

/* ------------------------------------------------------------------------------- the grid */

const b64ToBytes = s => {
  const bin = atob(String(s || ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

const bytesToB64 = buf => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let bin = '';
  // In chunks, because String.fromCharCode takes its arguments on the stack.
  for (let i = 0; i < bytes.length; i += 0x8000)
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};

/**
 * A band of a sheet's grid, as the writer compressed it. The rows inside are the writer's
 * business — this layer moves bytes and counts them.
 */
export async function putSlab(env, sheetId, body) {
  const sheet = await readSheetRow(env, sheetId);
  if (!sheet) throw new HttpError(404, 'no such sheet.');
  const band = Math.max(0, +(body && body.band) || 0);
  const bytes = b64ToBytes(body && body.cells);
  if (!bytes.length) throw bad('that band has no bytes in it.');
  if (bytes.length > SLAB_MAX)
    throw bad(`a band is ${bytes.length} bytes, over the ${SLAB_MAX} this keeps to. Send fewer rows.`);
  const count = Math.max(0, +(body && body.count) || 0);

  await env.DB.prepare(
    `INSERT INTO slabs (sheet_id, band, cells, count, bytes) VALUES (?,?,?,?,?)
     ON CONFLICT(sheet_id, band) DO UPDATE SET cells = excluded.cells,
       count = excluded.count, bytes = excluded.bytes`)
    .bind(sheet.id, band, bytes, count, bytes.length).run();

  const tally = await env.DB.prepare(
    'SELECT SUM(count) AS cells FROM slabs WHERE sheet_id = ?').bind(sheet.id).first();
  await env.DB.prepare('UPDATE sheets SET cells = ? WHERE id = ?')
    .bind((tally && tally.cells) || 0, sheet.id).run();
  return { band, bytes: bytes.length, count };
}

/** The bands covering rows `from`..`to`, still compressed — the browser unzips them. */
export async function readBands(env, sheetId, from, to) {
  const sheet = await readSheetRow(env, sheetId);
  if (!sheet) throw new HttpError(404, 'no such sheet.');
  const firstBand = Math.max(0, Math.floor((+from || 0) / BAND));
  const lastBand = Math.max(firstBand, Math.floor((+to || (+from || 0)) / BAND));
  if (lastBand - firstBand > 40) throw bad('that is too many rows at once.');
  const { results } = await env.DB.prepare(
    'SELECT band, cells, count FROM slabs WHERE sheet_id = ? AND band BETWEEN ? AND ? ORDER BY band')
    .bind(sheet.id, firstBand, lastBand).all();
  return {
    sheetId: sheet.id, band: BAND, version: sheet.version,
    bands: (results || []).map(r => ({ band: r.band, count: r.count, cells: bytesToB64(r.cells) })),
  };
}

export async function putStyles(env, fileId, body) {
  const file = await readFileRow(env, fileId);
  if (!file) throw new HttpError(404, 'no such file.');
  const list = Array.isArray(body && body.styles) ? body.styles : [];
  if (list.length > 20000) throw bad('that is more styles than a workbook can have.');
  const stmts = [env.DB.prepare('DELETE FROM styles WHERE file_id = ?').bind(file.id)];
  list.forEach((style, idx) => {
    stmts.push(env.DB.prepare('INSERT INTO styles (file_id, idx, json) VALUES (?,?,?)')
      .bind(file.id, idx, JSON.stringify(style || {})));
  });
  for (const group of chunk(stmts, 40)) await env.DB.batch(group);
  return { styles: list.length };
}

const META_KINDS = new Set(['merges', 'cols', 'rows', 'validation', 'conditional', 'filter',
                            'links', 'images', 'notes']);

export async function putMeta(env, sheetId, body) {
  const sheet = await readSheetRow(env, sheetId);
  if (!sheet) throw new HttpError(404, 'no such sheet.');
  const kind = str(body && body.kind);
  if (!META_KINDS.has(kind)) throw bad(`there is nothing kept under "${kind}".`);
  const json = JSON.stringify(body.json === undefined ? null : body.json);
  if (json.length > 900000) throw bad('that is too much for one sheet to carry.');
  await env.DB.prepare(
    `INSERT INTO sheet_meta (sheet_id, kind, json) VALUES (?,?,?)
     ON CONFLICT(sheet_id, kind) DO UPDATE SET json = excluded.json`)
    .bind(sheet.id, kind, json).run();
  return { kind, bytes: json.length };
}

export async function readMeta(env, sheetId) {
  const sheet = await readSheetRow(env, sheetId);
  if (!sheet) throw new HttpError(404, 'no such sheet.');
  const { results } = await env.DB.prepare(
    'SELECT kind, json FROM sheet_meta WHERE sheet_id = ?').bind(sheet.id).all();
  const out = {};
  for (const r of results || []) out[r.kind] = parseJson(r.json, null);
  return { sheetId: sheet.id, meta: out };
}

/** An import says it is finished: the file becomes visible, with its report attached. */
export async function finishFile(env, fileId, body) {
  const file = await readFileRow(env, fileId);
  if (!file) throw new HttpError(404, 'no such file.');
  const tally = await env.DB.prepare(
    'SELECT COUNT(*) AS sheets, COALESCE(SUM(cells), 0) AS cells FROM sheets WHERE file_id = ?')
    .bind(file.id).first();
  const report = body && body.report ? JSON.stringify(body.report) : file.report;
  await env.DB.prepare(
    'UPDATE files SET ready = 1, sheets = ?, cells = ?, report = ?, updated_at = ? WHERE id = ?')
    .bind(tally.sheets, tally.cells, report, now(), file.id).run();
  await logActivity(env, 'import', 'file:' + file.id,
    `imported ${file.name} — ${tally.sheets} sheet${tally.sheets === 1 ? '' : 's'}, `
    + `${Number(tally.cells).toLocaleString('en')} cells`);
  return { file: file.id, sheets: tally.sheets, cells: tally.cells };
}

/* ----------------------------------------------------------------------------- the pictures */

const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
               webp: 'image/webp', svg: 'image/svg+xml', emf: 'image/emf', bmp: 'image/bmp' };

export const mimeFor = path => MIME[String(path || '').split('.').pop().toLowerCase()] || null;

/**
 * A picture, by the hash of its bytes. Pasted into six sheets, it is stored once — and an
 * import that runs twice uploads nothing the second time.
 */
export async function putAsset(env, id, request) {
  if (!env.FILES) throw new HttpError(500,
    'this Worker has no R2 bucket bound. Create it with "wrangler r2 bucket create kartz-files" '
    + 'and add the binding to wrangler.toml.');
  const key = str(id);
  if (!/^[a-f0-9]{16,64}$/.test(key)) throw bad('an asset id is the hash of its bytes.');
  const mime = str(request.headers.get('content-type')) || 'application/octet-stream';
  if (!/^image\//.test(mime)) throw bad('only pictures are kept here.');

  const existing = await env.DB.prepare('SELECT id, bytes FROM assets WHERE id = ?').bind(key).first();
  if (existing) return { asset: key, bytes: existing.bytes, already: true };

  const body = await request.arrayBuffer();
  if (!body.byteLength) throw bad('that picture has no bytes.');
  if (body.byteLength > 12e6) throw bad('that picture is too large to keep.');
  await env.FILES.put(key, body, { httpMetadata: { contentType: mime } });
  await env.DB.prepare(
    'INSERT INTO assets (id, mime, bytes, created_at, created_by) VALUES (?,?,?,?,?)')
    .bind(key, mime, body.byteLength, now(), env.user ? env.user.id : null).run();
  return { asset: key, bytes: body.byteLength };
}

export async function getAsset(env, id) {
  if (!env.FILES) throw new HttpError(404, 'no pictures are kept on this Worker.');
  const key = str(id);
  if (!/^[a-f0-9]{16,64}$/.test(key)) throw bad('an asset id is the hash of its bytes.');
  const obj = await env.FILES.get(key);
  if (!obj) throw new HttpError(404, 'no such picture.');
  return new Response(obj.body, {
    headers: {
      'content-type': (obj.httpMetadata && obj.httpMetadata.contentType) || 'application/octet-stream',
      'cache-control': 'public, max-age=31536000, immutable',
      'content-length': String(obj.size),
    },
  });
}

/** Which of these are already here, so an import uploads only what is missing. */
export async function haveAssets(env, body) {
  const ids = (Array.isArray(body && body.ids) ? body.ids : []).map(str)
    .filter(x => /^[a-f0-9]{16,64}$/.test(x)).slice(0, 200);
  if (!ids.length) return { have: [] };
  const have = [];
  for (const group of chunk(ids, 50)) {
    const { results } = await env.DB.prepare(
      `SELECT id FROM assets WHERE id IN (${group.map(() => '?').join(',')})`).bind(...group).all();
    for (const r of results || []) have.push(r.id);
  }
  return { have };
}
